import { existsSync } from "node:fs";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	buildTaskHookEnv,
	buildWhippedMcpServerSpec,
	CLAUDE_TASK_SETTINGS_PATH,
	CURSOR_CONFIG_DIR_ENV,
	cleanupCursorConfigDir,
	cleanupPluginAgentFiles,
	getCursorConfigDir,
	getMcpConfigPath,
	getServerPort,
	isPluginConfigAgent,
	pluginAgentConfigDirEnv,
	writeClaudeMcpConfig,
	writeCursorConfigFiles,
	writePluginAgentFiles,
} from "../agents/agent-hooks.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import { type BrowserMcpServer, buildBrowserMcpServer, PLAYWRIGHT_MCP_SERVER_NAME } from "../agents/playwright-mcp.js";
import { ATTACHMENTS_DIR } from "../config/runtime-config.js";
import type {
	ModelPair,
	RuntimeBoardCard,
	RuntimeProjectSecret,
	RuntimeReviewComment,
	SlotModelConfig,
	TierLevel,
	WorkflowSlot,
} from "../core/api-contract.js";
import { DEFAULT_GIT_INSTRUCTIONS, isResumableSessionState, LEVEL_ORDER, resolvePair } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { resolvePromptText } from "../core/prompt-resolver.js";
import { generateTaskId } from "../core/task-id.js";
import { formatVisualElementsBlock, type VisualElementRef } from "../core/visual-comment.js";
import { formatDiffBlock, getGitFullDiff, getGitHeadSha, getGitStat } from "../git/git-diff-utils.js";
import { commitIfDirty, createGithubPR, pushBranch } from "../git/merge-operations.js";
import type { GithubClient } from "../github/github-client.js";
import { playNotificationSound } from "../notifications/sound-player.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { buildMemoryContext } from "../state/memory-store.js";
import {
	appendActivityLog,
	appendTerminalSession,
	endTerminalSession,
	linkCommentToSession,
	loadBoard,
	moveCard,
	saveAttachment,
	saveTerminalBuffer,
	stampReviewCommentMetadata,
	updateCard,
} from "../state/workspace-state.js";
import { getCardBranch, getWorktreePath, resolveWorktreeOwnerId } from "../worktree/worktree-manager.js";
import type { QaSemaphore } from "./qa-semaphore.js";
import { type ConflictResolver, enqueueYoloMerge } from "./yolo-merge.js";

interface ReviewPipelineOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	mcpBinary: { command: string; args: string[] };
	reviewSlots: WorkflowSlot[];
	maxAutoFixAttempts: number;
	stateHub: RuntimeStateHub;
	githubClient?: GithubClient;
	deliveryMode: "off" | "pr" | "yolo";
	scheduler: ConflictResolver;
	autoCommit: boolean;
	secrets: RuntimeProjectSecret[];
	systemPrompt?: string;
	qaSemaphore: QaSemaphore;
	registerStopCallback: (streamId: string, callback: () => void) => () => void;
	registerLiveProcess: (streamId: string, process: AgentProcess) => () => void;
	isStreamManuallyStopped: (streamId: string) => boolean;
}

type ReviewSlotResult =
	| { stopped: true }
	| { stopped?: undefined; passed: boolean; comment: RuntimeReviewComment; storedViaMcp: boolean };

// Resolve the concrete model pair a review slot runs at, from the card's snapshot
// (preferred) or the slot template, using the card's workflow-wide active level.
function resolveSlotPair(card: RuntimeBoardCard, slot: WorkflowSlot): ModelPair {
	const cfg: SlotModelConfig = card.modelConfig?.[slot.id] ?? {
		pairs: slot.pairs,
		mode: slot.mode,
	};
	return resolvePair(cfg, card.activeLevel);
}

// Comment type for a slot: orch keeps its fixed "orch" type; every other slot is
// keyed by its id so multiple review slots get distinct, independently-anchored comments.
function slotCommentType(slot: WorkflowSlot): string {
	return slot.type === "orch" ? "orch" : slot.id;
}

function isTierLevel(v: unknown): v is TierLevel {
	return typeof v === "string" && (LEVEL_ORDER as readonly string[]).includes(v);
}

export async function runReviewPipeline(card: RuntimeBoardCard, options: ReviewPipelineOptions): Promise<void> {
	const { workspaceId, stateHub } = options;
	const runId = Date.now();

	// Reload card to get the latest state. A "failed" last terminal session means the pipeline
	// was interrupted (crash or agent failure) — resume from the first slot that didn't pass.
	const freshBoard = await loadBoard(workspaceId);
	card = freshBoard.cards[card.id] ?? card;
	const lastTs = card.terminalSessions?.at(-1);
	// Story cards have no dev session, so resume logic doesn't apply — always run orch fresh.
	const isResume = card.type !== "story" && isResumableSessionState(lastTs?.state);
	const lastDevTs = card.terminalSessions
		?.slice()
		.reverse()
		.find((ts) => ts.type === "dev");
	const sessionStartedAt = lastDevTs?.startedAt ?? 0;

	logger.info(
		`[review] Starting review pipeline for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" (${card.id})${isResume ? " — resuming" : ""}`,
	);
	await appendActivityLog(workspaceId, card.id, "AI review started");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// When resuming, skip slots that already passed — stop skipping at the first failure/missing.
	let skipPassed = isResume;

	for (const slot of options.reviewSlots) {
		const customPrompt = resolvePromptText(slot.prompt, options.repoPath);
		const streamId = `${card.id}-${slot.id}-${runId}`;
		const slotPair = resolveSlotPair(card, slot);

		if (skipPassed) {
			const commentType = slotCommentType(slot);
			const lastSlotComment = [...(card.reviewComments ?? [])].reverse().find((c) => c.type === commentType);
			// Only skip if the passing comment belongs to THIS session (not a previous run).
			const alreadyPassed = lastSlotComment
				? lastSlotComment.createdAt >= sessionStartedAt &&
					lastSlotComment.status !== "fail" &&
					!(lastSlotComment.issues?.some((i) => i.severity === "blocking") ?? false)
				: false;
			if (alreadyPassed) {
				logger.info(
					`[review] ${slot.name} already passed for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" — skipping`,
				);
				await appendActivityLog(workspaceId, card.id, `${slot.name}: already passed — skipping`);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				continue;
			}
			skipPassed = false; // found the first slot to run — run this and all remaining
		}

		// Slots with the browser tool boot the app — heavy and port-bound — so they
		// pass through a machine-wide semaphore. If every slot is busy the card waits
		// here (FIFO) instead of piling on; the wait is surfaced in the activity log.
		const usesBrowser = slot.tools.includes("browser");
		let release: (() => void) | undefined;
		if (usesBrowser) {
			if (options.qaSemaphore.wouldBlock()) {
				await appendActivityLog(workspaceId, card.id, `${slot.name}: queued — waiting for a free QA slot`);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
			}
			release = await options.qaSemaphore.acquire();
		}

		let result: ReviewSlotResult;
		try {
			await appendActivityLog(workspaceId, card.id, `${slot.name} running (${slotPair.binary})`);
			await appendTerminalSession(workspaceId, card.id, {
				streamId,
				type: slot.id,
				startedAt: runId,
				agentId: slotPair.binary,
				state: "running",
			});
			stateHub.broadcastWorkspaceUpdate(workspaceId);

			result = await runReviewSlot(slot, card, streamId, options, customPrompt);
		} finally {
			release?.();
		}

		if (result.stopped) return;

		// Fold any browser screenshots the agent captured into its comment as proof,
		// in case it didn't attach them itself.
		if (usesBrowser) {
			await attachBrowserArtifacts(workspaceId, card, result, runId);
		}

		logger.info(
			`[review] ${slot.name} ${result.passed ? "PASSED" : "FAILED"} for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
		);

		if (!result.passed) {
			await appendActivityLog(workspaceId, card.id, `${slot.name}: FAIL`);
			if (!result.storedViaMcp) await persistComment(workspaceId, card, result.comment);
			// Auto-adjust: a review slot allowed to tune the tier may right-size the
			// rework via suggestedLevel — card-wide, so every agent re-resolves its own
			// model at the new level. (Cost mode is per-slot config, not the agent's to set.)
			if (slot.canAdjustLevel) {
				const suggestedLevel = result.comment.metadata?.suggestedLevel;
				if (isTierLevel(suggestedLevel) && suggestedLevel !== card.activeLevel) {
					await updateCard(workspaceId, card.id, { activeLevel: suggestedLevel });
					card = { ...card, activeLevel: suggestedLevel };
					await appendActivityLog(workspaceId, card.id, `Model tier set to "${suggestedLevel}" for rework`);
				}
			}
			await handleReviewFailure(card, options);
			return;
		}

		await appendActivityLog(workspaceId, card.id, `${slot.name}: PASS`);
		if (!result.storedViaMcp) await persistComment(workspaceId, card, result.comment);
		card = { ...card, reviewComments: [...(card.reviewComments ?? []), result.comment] };
		stateHub.broadcastWorkspaceUpdate(workspaceId);
	}

	await handleReviewSuccess(card, options);
}

async function runReviewSlot(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
	customPrompt: string,
): Promise<ReviewSlotResult> {
	const { workspaceId, stateHub } = options;
	const pair = resolveSlotPair(card, slot);
	const agentBinary = pair.binary;
	const browserEnabled = slot.tools.includes("browser");
	// Orch slots use the story card's shared worktree (story is the worktree owner).
	// Falls back to repoPath if that worktree no longer exists.
	// Non-orch slots run in the card's resolved worktree (dependsOn chain root / story owner).
	const reviewBoard = await loadBoard(workspaceId);
	const orchWorktreePath = getWorktreePath(card.id);
	const worktreePath =
		slot.type === "orch"
			? existsSync(orchWorktreePath)
				? orchWorktreePath
				: options.repoPath
			: getWorktreePath(resolveWorktreeOwnerId(card.id, reviewBoard.cards));
	const commentType = slotCommentType(slot);
	// Anchor a follow-up review to the HEAD a prior same-type review looked at,
	// so we only re-show what changed since. The anchor only holds when the work
	// was committed between rounds — with auto-commit off, HEAD never advances,
	// so priorSha === reviewedSha and we fall back to the full diff.
	const reviewedSha = getGitHeadSha(worktreePath);
	const priorReviewedSha = [...(card.reviewComments ?? [])]
		.reverse()
		.map((c) => (c.type === commentType ? c.metadata?.reviewedSha : undefined))
		.find((sha): sha is string => typeof sha === "string" && sha.length > 0);
	const useIncremental = !!reviewedSha && !!priorReviewedSha && priorReviewedSha !== reviewedSha;
	const scope: ReviewDiffScope = {
		isFollowUp: !!priorReviewedSha,
		useIncremental,
		diffRef: priorReviewedSha ?? card.baseRef,
	};
	const stat = getGitStat(worktreePath, card.baseRef);
	const fullDiff = getGitFullDiff(worktreePath, useIncremental ? priorReviewedSha! : card.baseRef);
	const context = formatPriorComments(card);
	// For orchestrator slots, preload subtask cards so we can inline them in
	// the prompt rather than forcing the agent to call kanban_get_board.
	let subtaskCards: RuntimeBoardCard[] = [];
	if (slot.type === "orch" && (card.subtaskIds?.length ?? 0) > 0) {
		subtaskCards = (card.subtaskIds ?? []).map((id) => reviewBoard.cards[id]).filter((c): c is RuntimeBoardCard => !!c);
	}
	const rawSystemPrompt = buildReviewSlotSystemPrompt(
		slot,
		card,
		stat,
		fullDiff,
		customPrompt,
		context.text,
		scope,
		options.secrets,
		options.systemPrompt,
		options.autoCommit,
		subtaskCards,
		browserEnabled,
	);
	// Prepend durable memory so review/QA/orch agents share the dev agent's context.
	const memContext = buildMemoryContext(workspaceId);
	const withMemory = memContext ? `${memContext}\n\n${rawSystemPrompt}` : rawSystemPrompt;
	// Cursor Agent CLI does not fire a settings.json stop hook reliably.
	// Tell it to call the task_complete MCP tool explicitly when done.
	const systemPrompt =
		agentBinary === "cursor"
			? `${withMemory}\n\nAfter calling \`kanban_add_comment\`, call the \`task_complete\` MCP tool to signal that you are done.`
			: withMemory;
	const triggerWord = getSlotTriggerWord(slot.type);

	const mcpConfigPath =
		!isPluginConfigAgent(agentBinary) && agentBinary !== "cursor" ? getMcpConfigPath(streamId) : undefined;
	const hookServerPort =
		agentBinary === "codex" || isPluginConfigAgent(agentBinary) || agentBinary === "cursor"
			? getServerPort(options.serverUrl)
			: undefined;
	const mcpServer =
		agentBinary === "codex" || isPluginConfigAgent(agentBinary) || agentBinary === "cursor"
			? buildWhippedMcpServerSpec(options.mcpBinary, options.serverUrl, workspaceId, agentBinary)
			: undefined;

	// Slots with the browser tool get the Playwright MCP alongside the whipped tools;
	// a browser launches only on the first navigate.
	const browserMcp: BrowserMcpServer | undefined = browserEnabled ? buildBrowserMcpServer(card.id) : undefined;
	const browserMcpSpec = browserMcp ? { command: browserMcp.command, args: browserMcp.args } : undefined;
	const extraMcpServers = browserMcpSpec ? { [PLAYWRIGHT_MCP_SERVER_NAME]: browserMcpSpec } : undefined;

	if (agentBinary === "claude" && mcpConfigPath) {
		await writeClaudeMcpConfig(
			options.mcpBinary,
			options.serverUrl,
			workspaceId,
			agentBinary,
			mcpConfigPath,
			extraMcpServers,
		).catch(() => {});
	}
	const startTime = Date.now();
	logger.info(
		`[review:${streamId}] Spawning ${slot.name} agent (${agentBinary}) for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
	);
	const secretsEnv = buildSecretsEnv(options.secrets);
	const output = await runAgentOnce(
		agentBinary,
		triggerWord,
		worktreePath,
		workspaceId,
		streamId,
		stateHub,
		options.registerStopCallback,
		options.registerLiveProcess,
		mcpConfigPath,
		systemPrompt,
		context.files,
		secretsEnv,
		pair.effort,
		hookServerPort,
		mcpServer,
		pair.model,
		slot.type,
		browserMcpSpec,
	);
	logger.info(`[review:${streamId}] ${slot.name} agent done (${Date.now() - startTime}ms)`);

	if (options.isStreamManuallyStopped(streamId)) {
		logger.info(`[review:${streamId}] ${slot.name} was manually stopped — ending session as stopped`);
		await endTerminalSession(workspaceId, card.id, streamId, Date.now(), "stopped");
		return { stopped: true as const };
	}

	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, commentType);
	if (mcpComment) {
		const endedAt = Date.now();
		const hasMustFixIssue = mcpComment.issues?.some((i) => i.severity === "blocking") ?? false;
		const passed = mcpComment.status !== "fail" && !hasMustFixIssue;
		await linkCommentToSession(workspaceId, card.id, mcpComment.createdAt, streamId);
		// Record the HEAD this review looked at so the next same-type review can
		// scope its diff to what changed since.
		if (reviewedSha) await stampReviewCommentMetadata(workspaceId, card.id, mcpComment.createdAt, { reviewedSha });
		await endTerminalSession(workspaceId, card.id, streamId, endedAt, passed ? "completed" : "failed");
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	// Non-MCP fallback. The agent skipped the `kanban_add_comment` MCP call.
	// If it at least emitted parseable JSON we respect that; otherwise we
	// post a tiny generic placeholder. We deliberately do NOT dump the
	// terminal buffer or a tail of it — the full session is already saved
	// under buffers/ and linked via streamId, and pasting raw output into
	// the comment pollutes downstream agent context.
	const parsed = tryParseAgentJson(output);
	const nowFallback = Date.now();
	if (parsed?.summary) {
		const status = parsed.status ?? "pass";
		const hasMustFixIssue = parsed.issues?.some((i: { severity: string }) => i.severity === "blocking") ?? false;
		const passed = status !== "fail" && !hasMustFixIssue;
		const comment: RuntimeReviewComment = {
			id: generateTaskId(),
			type: commentType,
			actor: { type: "ai", id: slot.name },
			status: status as RuntimeReviewComment["status"],
			createdAt: nowFallback,
			streamId,
			summary: parsed.summary,
			issues: parsed.issues,
			metadata: reviewedSha ? { ...(parsed.metadata ?? {}), reviewedSha } : parsed.metadata,
		};
		await endTerminalSession(workspaceId, card.id, streamId, nowFallback, passed ? "completed" : "failed");
		return { passed, storedViaMcp: false, comment };
	}
	const comment: RuntimeReviewComment = {
		id: generateTaskId(),
		type: commentType,
		actor: { type: "ai", id: slot.name },
		status: "warning",
		createdAt: nowFallback,
		streamId,
		summary: "(no result reported)",
		metadata: reviewedSha ? { reviewedSha } : undefined,
	};
	await endTerminalSession(workspaceId, card.id, streamId, nowFallback, "completed");
	return { passed: true, storedViaMcp: false, comment };
}

function getSlotTriggerWord(type: string): string {
	if (type === "review") return "Start Review.";
	if (type === "plan") return "Start planning.";
	return "Start.";
}

const SCREENSHOT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

// Fold browser screenshots captured during a QA run into its comment as proof.
// The browser capability writes them to the card's attachment dir; we pick up
// any image touched since the run began and route it through saveAttachment so
// it serves identically to agent-attached images (content-hash dedups against
// anything the agent already attached). A backstop for forgotten attachments.
async function attachBrowserArtifacts(
	workspaceId: string,
	card: RuntimeBoardCard,
	result: Extract<ReviewSlotResult, { stopped?: undefined }>,
	since: number,
): Promise<void> {
	const dir = join(ATTACHMENTS_DIR, card.id);
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}

	const existing = result.comment.attachments ?? [];
	const seenPaths = new Set(existing.map((a) => a.path));
	const captured: NonNullable<RuntimeReviewComment["attachments"]> = [];
	for (const name of entries) {
		const ext = name.split(".").pop()?.toLowerCase() ?? "";
		if (!SCREENSHOT_EXTENSIONS.has(ext)) continue;
		const filePath = join(dir, name);
		try {
			const info = await stat(filePath);
			if (!info.isFile() || info.mtimeMs < since) continue;
			const data = await readFile(filePath);
			const canonicalPath = await saveAttachment(data, ext === "jpg" ? "jpeg" : ext, card.id);
			if (seenPaths.has(canonicalPath)) continue;
			seenPaths.add(canonicalPath);
			captured.push({
				type: "image",
				name,
				mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
				path: canonicalPath,
			});
		} catch {
			// Skip unreadable files
		}
	}

	if (captured.length === 0) return;
	const merged = [...existing, ...captured];
	result.comment.attachments = merged;

	// MCP-stored comments are already persisted — update the stored row in place.
	// Non-MCP comments persist later via persistComment, carrying these along.
	if (result.storedViaMcp) {
		const board = await loadBoard(workspaceId);
		const latest = board.cards[card.id];
		if (!latest) return;
		const updatedComments = (latest.reviewComments ?? []).map((c) =>
			c.streamId === result.comment.streamId && c.createdAt === result.comment.createdAt
				? { ...c, attachments: merged }
				: c,
		);
		await updateCard(workspaceId, card.id, { reviewComments: updatedComments });
	}
}

async function persistComment(
	workspaceId: string,
	card: RuntimeBoardCard,
	comment: RuntimeReviewComment,
): Promise<void> {
	logger.info(`[review:${card.id}] Persisting ${comment.type} comment`);
	// Always reload from DB so we don't overwrite comments stored concurrently via MCP
	const board = await loadBoard(workspaceId);
	const latest = board.cards[card.id];
	const updatedComments = [...(latest?.reviewComments ?? []), comment];
	await updateCard(workspaceId, card.id, { reviewComments: updatedComments });
}

async function handleReviewFailure(card: RuntimeBoardCard, options: ReviewPipelineOptions): Promise<void> {
	const { workspaceId, maxAutoFixAttempts, stateHub } = options;

	if (card.type === "story") {
		// Orch failure: scan for subtasks that the orch left a fail comment on and reopen them.
		// The orch only needs to add comments — we handle the card moves server-side so a missed
		// kanban_move_card call can't leave a subtask stuck without a transition.
		logger.info(
			`[review] Orch review failed for story "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" → reopening flagged subtasks`,
		);
		const orchBoard = await loadBoard(workspaceId);
		const subtaskIds = card.dependsOn ?? [];
		const orchFailedAt = Date.now();
		let reopenedCount = 0;
		for (const subtaskId of subtaskIds) {
			const subtask = orchBoard.cards[subtaskId];
			if (!subtask) continue;
			const hasOrchFail = subtask.reviewComments?.some((c) => c.type === "orch" && c.status === "fail");
			if (hasOrchFail && subtask.columnId !== "reopened" && subtask.columnId !== "blocked") {
				await moveCard(workspaceId, subtaskId, "reopened");
				await appendActivityLog(workspaceId, subtaskId, "Orch review failed → moved to Reopened for rework");
				reopenedCount++;
			}
		}
		if (reopenedCount === 0) {
			// Orch failed but didn't comment on any subtask — propagate the story-level orch comment
			// down to each subtask so the dev agent has instructions when it picks the card up.
			logger.warn(
				`[review] Orch failed for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" but no subtask orch-fail comments found — propagating story comment to all subtasks`,
			);
			const reloadedStory = orchBoard.cards[card.id];
			const storyOrchComment = reloadedStory?.reviewComments
				?.slice()
				.reverse()
				.find((c) => c.type === "orch" && c.status === "fail");
			for (const subtaskId of subtaskIds) {
				const subtask = orchBoard.cards[subtaskId];
				if (!subtask || subtask.columnId === "blocked") continue;
				if (storyOrchComment) {
					const existing = subtask.reviewComments ?? [];
					await updateCard(workspaceId, subtaskId, {
						reviewComments: [
							...existing,
							{
								...storyOrchComment,
								createdAt: Date.now(),
								summary: `[From orchestrator review of story "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"]\n\n${storyOrchComment.summary}`,
							},
						],
					});
				}
				await moveCard(workspaceId, subtaskId, "reopened");
				await appendActivityLog(workspaceId, subtaskId, "Orch review failed → moved to Reopened");
				reopenedCount++;
			}
		}
		logger.info(`[review] Orch failure handled: ${reopenedCount} subtasks reopened (orchFailedAt=${orchFailedAt})`);
		await moveCard(workspaceId, card.id, "todo");
		await appendActivityLog(workspaceId, card.id, "Orchestrator review failed → waiting for subtask rework");
		stateHub.broadcastWorkspaceUpdate(workspaceId);
		return;
	}

	const newAttempts = card.autoFixAttempts + 1;
	const destination = newAttempts >= maxAutoFixAttempts ? "blocked" : "reopened";

	logger.info(
		`[review] Review failed for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" (attempt ${newAttempts}/${maxAutoFixAttempts}) → ${destination}`,
	);
	await updateCard(workspaceId, card.id, { autoFixAttempts: newAttempts });
	await moveCard(workspaceId, card.id, destination);
	await appendActivityLog(
		workspaceId,
		card.id,
		destination === "blocked"
			? `Max fix attempts reached (${newAttempts}) → moved to Blocked`
			: `Review failed (attempt ${newAttempts}/${maxAutoFixAttempts}) → moved to Reopened`,
	);
	// Worktree is intentionally kept when blocked so prior commits survive a manual restart
	stateHub.broadcastWorkspaceUpdate(workspaceId);
}

export function buildSecretsSection(secrets: RuntimeProjectSecret[]): string {
	const nonEmpty = secrets.filter((s) => s.key && s.value);
	if (nonEmpty.length === 0) return "";
	const keys = nonEmpty.map((s) => s.key).join(", ");
	return `## Available environment variables\n\n${keys}\n\nAccess them via \`$VAR_NAME\` in shell commands or \`process.env.VAR_NAME\` in scripts.`;
}

export function buildSecretsEnv(secrets: RuntimeProjectSecret[]): Record<string, string> {
	return Object.fromEntries(secrets.filter((s) => s.key && s.value).map((s) => [s.key, s.value]));
}

async function handleReviewSuccess(card: RuntimeBoardCard, options: ReviewPipelineOptions): Promise<void> {
	const { workspaceId, githubClient, stateHub, deliveryMode } = options;

	const cardDesc60 = card.description?.split("\n")[0]?.slice(0, 60) ?? card.id;

	// Card may have been deleted while the review pipeline was still in flight
	// (e.g. user deleted the card; orphan review agent kept running). Bail out
	// so we don't push to a now-missing worktree or move a non-existent card.
	const successBoard = await loadBoard(workspaceId);
	if (!successBoard.cards[card.id]) {
		logger.info(`[review] Skipping post-success actions for "${cardDesc60}" — card no longer exists`);
		return;
	}

	logger.info(`[review] Review passed for "${cardDesc60}" → ready for human review`);

	if (githubClient && card.githubIssueUrl) {
		try {
			logger.info(`[review] Posting GitHub comment on issue for "${cardDesc60}"`);
			await githubClient.postComment(
				card.githubIssueUrl,
				`✅ AI review passed for task "${cardDesc60}". Ready for human review.`,
			);
			logger.info(`[review] GitHub comment posted for "${cardDesc60}"`);
		} catch (err) {
			logger.error({ err }, `[review] Failed to post GitHub comment for "${cardDesc60}":`);
		}
	}

	await moveCard(workspaceId, card.id, "ready_for_review");
	await appendActivityLog(workspaceId, card.id, "All reviews passed → moved to Ready for Review");
	stateHub.broadcastWorkspaceUpdate(workspaceId);
	void playNotificationSound("readyForReview");

	if (deliveryMode === "off") return;

	// subtasks (type:"subtask") skip delivery — the story card delivers after orch passes.
	// Standalone dependent tasks (type:"task" stacked on a parent) deliver on their own.
	if (card.type === "subtask") return;

	if (deliveryMode === "yolo") {
		enqueueYoloMerge(options.repoPath, card, workspaceId, options.scheduler, stateHub);
		return;
	}

	// deliveryMode === "pr"
	{
		const prOwnerBoard = await loadBoard(workspaceId);
		const effectiveWorktreeId = resolveWorktreeOwnerId(card.id, prOwnerBoard.cards);
		const worktreePath = getWorktreePath(effectiveWorktreeId);
		const taskBranch = getCardBranch(card);
		const githubToken = options.secrets.find((s) => s.key === "GITHUB_TOKEN")?.value;
		if (!githubToken) {
			logger.warn(`[review] Auto PR skipped for "${cardDesc60}" — GITHUB_TOKEN not set in project secrets`);
			await appendActivityLog(
				workspaceId,
				card.id,
				"Auto PR skipped — GITHUB_TOKEN not set in project Settings > Secrets.",
			);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}
		try {
			await commitIfDirty(worktreePath, card.pr?.title ?? card.description?.split("\n")[0]?.slice(0, 72) ?? card.id);
			await pushBranch(worktreePath, taskBranch);
			const devSummary =
				[...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.summary ?? card.description;
			const prTitle = card.pr?.title ?? card.description?.split("\n")[0]?.slice(0, 72) ?? card.id;
			const prDescription = card.pr?.description ?? devSummary;
			let prUrl: string;
			if (card.pr?.url) {
				// PR already exists locally — push already updated it, nothing more to do
				prUrl = card.pr.url;
				logger.info(`[review] Auto PR: pushed to existing PR ${prUrl} for "${cardDesc60}"`);
			} else {
				logger.info(`[review] Auto PR: commit → push → create for "${cardDesc60}" (branch: ${taskBranch})`);
				prUrl = await createGithubPR(worktreePath, prTitle, prDescription, card.baseRef, githubToken);
				logger.info(`[review] Auto PR created: ${prUrl}`);
			}
			await updateCard(workspaceId, card.id, { pr: { ...card.pr, url: prUrl } });
			// Propagate PR URL to all subtasks sharing this story's worktree.
			const prBoard = await loadBoard(workspaceId);
			const subtasks = Object.values(prBoard.cards).filter(
				(c) => resolveWorktreeOwnerId(c.id, prBoard.cards) === card.id,
			);
			for (const subtask of subtasks) {
				if (!subtask.pr?.url) {
					await updateCard(workspaceId, subtask.id, { pr: { ...(subtask.pr ?? {}), url: prUrl } });
				}
			}
			await appendActivityLog(workspaceId, card.id, `Auto PR created → ${prUrl}`);
		} catch (err) {
			logger.error({ err }, `[review] Auto PR failed for "${cardDesc60}":`);
			await appendActivityLog(workspaceId, card.id, `Auto PR failed: ${String(err)}`);
		}
		stateHub.broadcastWorkspaceUpdate(workspaceId);
	}
}

function runAgentOnce(
	agentId: import("../core/api-contract.js").RuntimeAgentId,
	prompt: string,
	cwd: string,
	workspaceId: string,
	streamId: string,
	stateHub: RuntimeStateHub,
	registerStopCallback: ReviewPipelineOptions["registerStopCallback"],
	registerLiveProcess: ReviewPipelineOptions["registerLiveProcess"],
	mcpConfigPath?: string,
	appendSystemPrompt?: string,
	files?: string[],
	secretsEnv?: Record<string, string>,
	effort?: import("../core/api-contract.js").EffortLevel | null,
	hookServerPort?: number,
	mcpServer?: { command: string; args: string[] },
	model?: string | null,
	slotType?: string,
	browserMcpServer?: { command: string; args: string[] },
): Promise<string> {
	const extraMcp = browserMcpServer ? { [PLAYWRIGHT_MCP_SERVER_NAME]: browserMcpServer } : undefined;
	if (isPluginConfigAgent(agentId) && hookServerPort != null && mcpServer) {
		void writePluginAgentFiles(agentId, streamId, hookServerPort, mcpServer, { appendSystemPrompt, extraMcp }).catch(
			() => {},
		);
	}
	if (agentId === "cursor" && hookServerPort != null && mcpServer) {
		void writeCursorConfigFiles(streamId, hookServerPort, mcpServer, extraMcp).catch(() => {});
	}

	return new Promise((resolve) => {
		let output = "";
		let unregisterProcess: (() => void) | undefined;

		const unregister = registerStopCallback(streamId, () => {
			unregisterProcess?.();
			proc.kill();
			void saveTerminalBuffer(workspaceId, streamId, output);
			if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
			if (isPluginConfigAgent(agentId)) void cleanupPluginAgentFiles(agentId, streamId);
			if (agentId === "cursor") void cleanupCursorConfigDir(streamId);
			resolve(output);
		});

		logger.info(`[review:${streamId}] Spawning agent "${agentId}" in ${cwd}`);
		const proc = spawnAgent({
			agentId,
			prompt,
			cwd,
			mode: "interactive",
			env: {
				...buildTaskHookEnv(streamId, workspaceId),
				...secretsEnv,
				...(slotType ? { WHIPPED_SLOT: slotType } : {}),
				...pluginAgentConfigDirEnv(agentId, streamId),
				...(agentId === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(streamId) } : {}),
			},
			hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			hookServerPort: agentId === "codex" ? hookServerPort : undefined,
			mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
			mcpServer: agentId === "codex" ? mcpServer : undefined,
			browserMcpServer: agentId === "codex" ? browserMcpServer : undefined,
			appendSystemPrompt: isPluginConfigAgent(agentId) ? undefined : appendSystemPrompt,
			files: agentId === "claude" ? files : undefined,
			effort,
			model,
			onOutput: (data) => {
				output += data;
				stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
			},
			onExit: () => {
				logger.info(`[review:${streamId}] Agent "${agentId}" exited`);
				unregisterProcess?.();
				unregister();
				void saveTerminalBuffer(workspaceId, streamId, output);
				if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
				if (isPluginConfigAgent(agentId)) void cleanupPluginAgentFiles(agentId, streamId);
				if (agentId === "cursor") void cleanupCursorConfigDir(streamId);
				resolve(output);
			},
		});

		unregisterProcess = registerLiveProcess(streamId, proc);
	});
}

/**
 * Format a single comment as a markdown block. Headings use `headingLevel`
 * (### for top-level, #### for nested-in-iteration). `stripMustFix` removes
 * the "MUST FIX" warning — used for previous-iteration entries that were
 * already resolved by the iteration completing.
 */
// Number attachments as [Attachment #N] so inline `[Attachment #N]` references
// in the description/summary resolve to a specific file.
function attachmentLines(attachments: { name: string; path: string }[]): string {
	return attachments.map((a, i) => `- [Attachment #${i + 1}] ${a.name}: ${a.path}`).join("\n");
}

function formatComment(
	c: RuntimeBoardCard["reviewComments"][number],
	opts: { headingLevel: "###" | "####"; stripMustFix: boolean },
): string {
	const typeLabel =
		c.type === "human"
			? "Human Feedback"
			: c.type === "visual-comment"
				? "Visual Feedback"
				: c.type.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
	const actorId = c.actor.id;
	const statusLabel = c.status?.toUpperCase() ?? "";
	const hasMustFix = c.issues?.some((i) => i.severity === "blocking" || i.severity === "warning") ?? false;
	const failedRound = c.status === "fail" || hasMustFix;
	const mustFix = failedRound && !opts.stripMustFix ? " ⚠ MUST FIX BEFORE PROCEEDING" : "";

	const parts: string[] = [
		`${opts.headingLevel} ${typeLabel} · ${actorId}${statusLabel ? ` · ${statusLabel}` : ""}${mustFix}`,
	];
	if (c.summary) parts.push(c.summary);

	if (c.issues?.length) {
		for (const issue of c.issues) {
			const loc = issue.file ? `${issue.file}${issue.line != null ? `:${issue.line}` : ""}` : "";
			parts.push(`- [${issue.severity}]${loc ? ` ${loc}` : ""} — ${issue.message}`);
		}
	}

	if (c.attachments?.length) {
		parts.push(`Attached files (use Read tool to view):\n${attachmentLines(c.attachments)}`);
	}

	if (c.metadata?.visualComment && typeof c.metadata.visualComment === "object") {
		const vc = c.metadata.visualComment as { pageUrl?: string; elements?: VisualElementRef[] };
		const block = formatVisualElementsBlock(vc.elements ?? [], vc.pageUrl);
		if (block) parts.push(block);
	} else if (c.metadata && Object.keys(c.metadata).length > 0) {
		for (const [k, v] of Object.entries(c.metadata)) {
			if (typeof v !== "object") parts.push(`${k}: ${String(v)}`);
		}
	}

	return parts.join("\n");
}

/**
 * Group comments into iteration cycles.
 *
 * An iteration = one round of user/external input followed by AI work. A new
 * iteration starts when we see a non-AI comment after an AI cycle has started
 * (NOT necessarily after the AI summary was written — we use terminal-session
 * startedAt timestamps so that comments arriving mid-run get correctly bumped
 * into the NEXT iteration, since the running AI didn't see them).
 */
type Iteration = {
	input: RuntimeBoardCard["reviewComments"]; // non-AI comments
	work: RuntimeBoardCard["reviewComments"]; // AI comments
};

function groupIntoIterations(card: RuntimeBoardCard): Iteration[] {
	const comments = [...(card.reviewComments ?? [])].sort((a, b) => a.createdAt - b.createdAt);
	if (comments.length === 0) return [];

	const sessions = card.terminalSessions ?? [];

	// Effective "start time" of an AI comment = the session's startedAt when
	// its prompt was formed. This is what determines which iteration the AI's
	// output belongs to (since the AI saw all comments before its start).
	const aiStartTime = (c: RuntimeBoardCard["reviewComments"][number]): number => {
		if (c.streamId) {
			const s = sessions.find((s) => s.streamId === c.streamId);
			if (s?.startedAt != null) return s.startedAt;
		}
		return c.createdAt;
	};

	// Pass 1 — iteration boundaries. A non-AI comment opens a new iteration
	// iff some AI session has started since the previous boundary. We look at
	// the session list directly (not just AI summaries we've processed) so
	// mid-run comments correctly land in the NEXT iteration.
	const boundaries: number[] = [];
	for (const c of comments) {
		if (c.actor.type === "ai") continue;
		const prev = boundaries[boundaries.length - 1];
		if (prev == null) {
			boundaries.push(c.createdAt);
			continue;
		}
		const aiStartedSincePrev = sessions.some(
			(s) => s.startedAt != null && s.startedAt > prev && s.startedAt <= c.createdAt,
		);
		if (aiStartedSincePrev) boundaries.push(c.createdAt);
	}

	// No non-AI comments at all (programmatic kickoff) — single iteration of
	// pure AI work.
	if (boundaries.length === 0) {
		return [{ input: [], work: comments }];
	}

	const iterations: Iteration[] = boundaries.map(() => ({ input: [], work: [] }));

	const findIterIdx = (timestamp: number): number => {
		let idx = 0; // orphan AI before any user input → iter 0
		for (let i = 0; i < boundaries.length; i++) {
			if (boundaries[i]! <= timestamp) idx = i;
			else break;
		}
		return idx;
	};

	for (const c of comments) {
		const isAI = c.actor.type === "ai";
		const ts = isAI ? aiStartTime(c) : c.createdAt;
		const idx = findIterIdx(ts);
		const iter = iterations[idx]!;
		if (isAI) iter.work.push(c);
		else iter.input.push(c);
	}

	return iterations.filter((it) => it.input.length > 0 || it.work.length > 0);
}

function formatPriorComments(card: RuntimeBoardCard): { text: string; files: string[] } {
	const iterations = groupIntoIterations(card);
	if (iterations.length === 0) return { text: "", files: [] };

	const sections: string[] = [];

	// Previous iterations: everything except the last
	const previous = iterations.slice(0, -1);
	const current = iterations[iterations.length - 1];

	if (previous.length > 0) {
		const lines: string[] = [
			"## Previous Iterations",
			"_For context only — already addressed. Do not redo unless explicitly asked._",
		];
		previous.forEach((it, idx) => {
			lines.push("");
			lines.push(`### Iteration ${idx + 1}`);
			const all = [...it.input, ...it.work].sort((a, b) => a.createdAt - b.createdAt);
			for (const c of all) {
				lines.push("");
				lines.push(formatComment(c, { headingLevel: "####", stripMustFix: true }));
			}
		});
		sections.push(lines.join("\n"));
	}

	if (current) {
		const hasInput = current.input.length > 0;
		const hasWork = current.work.length > 0;
		// hasInput && hasWork  → mid-iteration, both user input and AI responses
		// hasInput && !hasWork → only user input, AI hasn't responded yet
		// !hasInput && hasWork → programmatic flow (no user comments ever), AI work in progress
		const heading =
			hasInput && hasWork
				? "## Current Iteration (in progress)"
				: hasInput
					? "## New Feedback (address this round)"
					: "## Prior agent activity";

		const lines: string[] = [heading];

		// In current iteration, only top-level ### headings (no Iteration N grouping)
		const all = [...current.input, ...current.work].sort((a, b) => a.createdAt - b.createdAt);
		for (const c of all) {
			lines.push("");
			lines.push(formatComment(c, { headingLevel: "###", stripMustFix: false }));
		}

		sections.push(lines.join("\n"));
	}

	if (sections.length === 0) return { text: "", files: [] };
	return {
		text: `\n\n---\n\n${sections.join("\n\n---\n\n")}`,
		files: [],
	};
}

/**
 * Whether this review is a follow-up to an earlier round and, if so, the ref to
 * diff against. `useIncremental` is false when the work hasn't been committed
 * since the last review (HEAD unchanged) — then we fall back to the full diff.
 */
type ReviewDiffScope = { isFollowUp: boolean; useIncremental: boolean; diffRef: string };

/** Replaces a review agent's full checklist on follow-up rounds. */
const FOLLOWUP_REVIEW_FOCUS = `**This is a follow-up review.** An earlier version of this work already passed review in a prior round — only the \`## New Feedback\` / \`## Current Iteration\` items triggered this run. Re-review ONLY: (1) whether those items were addressed in the changes below, and (2) whether the new changes introduced a regression or broke a caller (grep callers of anything touched to confirm). Do NOT re-litigate previously-approved code or raise issues unrelated to this round's feedback.`;

/**
 * Renders the changed-files + diff section. On an incremental follow-up the diff
 * is scoped to what changed since the last review, with the full changeset left
 * as a stat summary + a fetch hint so regressions can still be chased.
 */
function renderReviewDiff(stat: string, fullDiff: string, baseRef: string, scope: ReviewDiffScope): string {
	if (!scope.useIncremental) {
		return `## Changed files\n${stat}\n\n## Diff\n${formatDiffBlock(fullDiff, baseRef)}`;
	}
	return `## Changed files (full changeset vs \`${baseRef}\`, for context)\n${stat}\n\n## Changes since your last review (review THIS)\n_The diff below is only what changed since you last reviewed this card. The full changeset is summarised above; run \`git diff ${baseRef}...HEAD\` only if you need it to chase a regression._\n${formatDiffBlock(fullDiff, scope.diffRef, "Incremental diff")}`;
}

/** Shared instruction reminding agents how to treat the iteration-grouped comments. */
const ITERATION_SCOPING_NOTE = `
**About prior comments:** any \`## Previous Iterations\` or \`## Prior agent activity\` section is for context only — already addressed in earlier rounds or shown as background. Do NOT re-implement or re-verify that work unless the current iteration explicitly asks for it. Focus your effort on \`## New Feedback\` / \`## Current Iteration\`.`.trim();

/** Visual-comment usage hint for the dev agent. */
const VISUAL_COMMENT_HINT = `
**Visual Feedback comments** carry annotation metadata (\`elementSelector\`, \`elementText\`, \`pageUrl\`, and for Angular a \`componentChain\` outer→inner). To locate the affected code, grep for any selector in the chain (Angular) or open the \`Source\` file:line directly (React). Use \`elementText\` to narrow down when multiple instances exist.`.trim();

// Exported — used by scheduler.ts for dev agent
export function buildDevAgentSystemPrompt(
	_slot: WorkflowSlot,
	card: RuntimeBoardCard,
	customPrompt: string,
	worktreePath?: string,
	secrets: RuntimeProjectSecret[] = [],
	parentCards: RuntimeBoardCard[] = [],
	systemPrompt?: string,
	gitInstructions?: string,
	autoCommit = true,
	effectiveBaseRef?: string,
	siblingCards: RuntimeBoardCard[] = [],
): { text: string; files: string[] } {
	const effectiveGitInstructions = gitInstructions?.trim() || DEFAULT_GIT_INSTRUCTIONS;
	const priorPr = card.pr;
	const PRIOR_DESC_INLINE_LIMIT = 4000;
	let priorPrSection = "";
	if (priorPr?.title || priorPr?.description) {
		const descRaw = priorPr.description ?? "";
		const descTruncated = descRaw.length > PRIOR_DESC_INLINE_LIMIT;
		const descInline = descTruncated
			? `${descRaw.slice(0, PRIOR_DESC_INLINE_LIMIT)}\n\n[…truncated at ${PRIOR_DESC_INLINE_LIMIT} of ${descRaw.length} chars — call \`kanban_get_pr_meta\` to read the full text]`
			: descRaw || "(unset)";
		priorPrSection = `\n\nA previous run already wrote PR metadata for this card:\n\n**title:** ${priorPr.title ?? "(unset)"}\n\n**description:**\n${descInline}\n\nRevise these values rather than rewriting from scratch, unless they no longer reflect what shipped.`;
	}
	const context = formatPriorComments(card);
	const parts: string[] = [];

	const statBase = effectiveBaseRef ?? card.baseRef;
	const fullDiff = worktreePath ? getGitFullDiff(worktreePath, statBase) : "";
	// First dev run = no prior dev summary on this card. On a fresh worktree
	// there's no diff to show; saying nothing leaves the agent guessing and
	// prompts it to waste a tool call running `git diff` to verify.
	const isFirstDevRun = !(card.reviewComments ?? []).some((c) => c.type === "dev");
	let statSection = "";
	if (worktreePath) {
		if (fullDiff) {
			const stat = getGitStat(worktreePath, statBase);
			statSection = `\n\n## Current worktree state (vs ${statBase})\n${stat}\n\n## Diff (vs ${statBase})\n${formatDiffBlock(fullDiff, statBase, "Git diff")}`;
		} else if (isFirstDevRun) {
			statSection = `\n\n## Worktree state\n\nThis is the initial dev run on this card. The worktree is clean and branched from \`${statBase}\` — there is no prior diff to inspect. Skip \`git diff\` and start implementing.`;
		} else {
			// Subsequent run with no diff — unusual; surface the stat helper's message
			const stat = getGitStat(worktreePath, statBase);
			statSection = `\n\n## Current worktree state (vs ${statBase})\n${stat}`;
		}
	}

	const descAttachNote =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use the Read tool to view each one):\n${attachmentLines(card.descriptionAttachments ?? [])}`
			: "";
	parts.push(`## Task\n\n${card.description ?? ""}${descAttachNote}${statSection}${context.text}`);

	if (card.plan?.trim()) {
		parts.push(
			`## Implementation plan\n\nA planning agent produced this plan for the task. Follow it, adapting only where the code clearly requires it:\n\n${card.plan.trim()}`,
		);
	}

	if (parentCards.length > 0) {
		const parentSummaries = parentCards
			.map((p) => {
				const devComment = [...(p.reviewComments ?? [])].reverse().find((c) => c.type === "dev");
				if (!devComment) return null;
				const desc = p.description ? `${p.description}\n\n` : "";
				return `### [${p.id}]\n${desc}**Dev summary:** ${devComment.summary}`;
			})
			.filter((s): s is string => s !== null);
		if (parentSummaries.length > 0) {
			parts.push(
				`## Context from parent tasks\n\nThis task builds on top of the following completed work:\n\n${parentSummaries.join("\n\n")}`,
			);
		}
	}

	if (siblingCards.length > 0) {
		const siblingSummaries = siblingCards
			.map((s) => {
				const devComment = [...(s.reviewComments ?? [])].reverse().find((c) => c.type === "dev");
				if (!devComment) return null;
				const desc = s.description ? `${s.description}\n\n` : "";
				return `### [${s.id}]\n${desc}**Dev summary:** ${devComment.summary}`;
			})
			.filter((s): s is string => s !== null);
		if (siblingSummaries.length > 0) {
			parts.push(
				`## Work already in this worktree\n\nThe following sibling tasks have already been completed in this shared working directory. Their changes are visible in your working directory — build on them, do not re-implement:\n\n${siblingSummaries.join("\n\n")}`,
			);
		}
	}

	const commitInstruction = autoCommit
		? `1. Commit all changes. Write the commit message following the project's git conventions (see "## Git conventions" below) — do not use a hard-coded template like the task title.`
		: `1. Do NOT commit your changes. Leave all changes uncommitted in the worktree — the user will review and commit manually when they trigger Merge or Create PR.`;

	parts.push(`You are an autonomous coding agent working on a Kanban task.

Work autonomously without asking for permission or confirmation. You have full access to the codebase in your current working directory. Your worktree is branched off \`${effectiveBaseRef ?? card.baseRef}\`.

${ITERATION_SCOPING_NOTE}
For the current iteration's comments, you MUST address every issue listed — including info-level ones. Do not skip any.

${VISUAL_COMMENT_HINT}

When you finish your work:

1. Call the \`kanban_add_comment\` MCP tool **exactly once**, as your final step:
   - cardId: "${card.id}"
   - type: "dev"
   - status: "pass" if successful, "fail" if you were unable to complete the task
   - summary: 2–5 sentences for the next reviewer agent in this pipeline (NOT the PR description — that already went to set_pr_meta). Mention key decisions and any known limitations.
   Finalize and double-check your summary BEFORE calling it. Do not post a draft and then a correction — make all your checks first, then write one accurate comment. Calling it more than once creates duplicate comments.

2. Call the \`kanban_set_pr_meta\` MCP tool with:
   - cardId: "${card.id}"
   - title: PR title following the git conventions below
   - description: PR description body following the git conventions below
   This is what the daemon will use when it creates the PR. **Skip this call only when you genuinely made no code changes** (e.g. you concluded the task was already done).${priorPrSection}

${commitInstruction.replace(/^1\. /, "3. ")}

4. Reconcile memory. Review this task's description, the user's comments, and any decision or correction that came up while you worked. If something **changed, contradicted, reversed, or superseded** an entry in the Memory list above, call \`whipped_update_memory\` on that entry's id so future tasks don't act on stale knowledge (e.g. the user says "stop using short ids, use full kebab-case" → update the id-convention memory, don't leave the old one). Most tasks need NO new memory — skip this step by default. Only \`whipped_save_memory\` if a cross-cutting rule or non-obvious trap came up that you'd have wanted *before* starting and that isn't already recoverable by reading the code, schema, or a controller — endpoint shapes, column lists, field names, and per-page layout are code, not memory. Do NOT create a second memory that conflicts with an existing one — update the existing one instead.`);

	parts.push(`## Memory

This project has its own persistent memory. The \`whipped_save_memory\` / \`whipped_update_memory\` MCP tools ARE this project's memory — do NOT use your own notes, scratch files, CLAUDE.md, or any other memory system for durable facts.

When you are asked to "remember", "save to memory", "note for next time" — or you hit a cross-cutting convention, an architecture decision, a non-obvious repo-wide gotcha, or a correction the user made — record it in memory. Do NOT record what is already in the code or schema (endpoint request/response shapes, query params, column lists, field names, colour classes, per-page layout): if your note would cite the file where the truth lives, the file is the memory — skip it. Keep each entry to one focused fact in 1-3 sentences.

Before recording, check the memory list injected above (each entry shows its \`[id]\`) and \`whipped_search_memory\`. If what you're recording **contradicts, reverses, supersedes, corrects, or is a near-duplicate of** an existing memory, call \`whipped_update_memory\` with that memory's id and overwrite it — do NOT create a second, conflicting entry. Only \`whipped_save_memory\` when there is genuinely no existing memory about the same thing. Use \`whipped_get_memory\` to read one in full.

Scope a memory \`project\` for facts specific to this repo, or \`global\` for things that apply across all the user's projects (style/preferences).`);

	if (customPrompt.trim()) parts.push(`## Project-specific instructions\n\n${customPrompt.trim()}`);

	const secretsSection = buildSecretsSection(secrets);
	if (secretsSection) parts.push(secretsSection);

	if (systemPrompt?.trim()) parts.push(`## Project context\n\n${systemPrompt.trim()}`);

	parts.push(`## Git conventions\n\n${effectiveGitInstructions}`);

	return { text: parts.join("\n\n"), files: context.files };
}

function buildReviewSlotSystemPrompt(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	scope: ReviewDiffScope,
	secrets: RuntimeProjectSecret[] = [],
	systemPrompt?: string,
	autoCommit = true,
	subtaskCards: RuntimeBoardCard[] = [],
	browserEnabled = false,
): string {
	if (slot.type === "orch") {
		return buildOrchSystemPrompt(
			slot,
			card,
			stat,
			fullDiff,
			customPrompt,
			priorContext,
			scope,
			secrets,
			systemPrompt,
			autoCommit,
			subtaskCards,
		);
	}
	return buildMergedReviewSystemPrompt(
		slot,
		card,
		stat,
		fullDiff,
		customPrompt,
		priorContext,
		scope,
		secrets,
		systemPrompt,
		browserEnabled,
	);
}

// One reviewer that replaces the old code_review / qa / custom slots. What it does
// is shaped by the slot's own prompt and its granted tools: with the browser tool
// it can exercise a running UI (the QA case); without it, it stays a code reviewer.
// Several review slots can be chained via `order`. The comment is keyed by slot.id.
function buildMergedReviewSystemPrompt(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	scope: ReviewDiffScope,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
	browserEnabled = false,
): string {
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";

	const descAttachSection =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use Read tool to view):\n${attachmentLines(card.descriptionAttachments ?? [])}`
			: "";

	const browserSection = browserEnabled
		? `
- You have a **browser capability** via the \`browser_*\` MCP tools (Playwright). When the change is user-facing, exercise the running UI:
  - \`browser_navigate\` to the URL you booted, then drive the change by element ref from \`browser_snapshot\` (not coordinates).
  - Capture a \`browser_take_screenshot\` of the change working, and read \`browser_console_messages\` — surface any errors as issues.
  - **You opened it, so you close it**: call \`browser_close\` when done. Always shut down any app process you started, too.`
		: "";

	const runningAppSection = browserEnabled
		? `

## Proving it works in a running app
Don't just read the diff — exercise the change when it's user-facing or runnable:
- Boot the app yourself with the project's install/run scripts. Pick a free port and read the URL it prints.${browserSection}
- Attach screenshots and any relevant logs as proof on your comment (below) so they're tied to your verdict.`
		: "";

	const levelAdjustSection = slot.canAdjustLevel
		? `

## Right-sizing the rework on reopen
When you set status "fail" (reopening for rework), you can right-size the **tier** the next round runs at. It applies to every agent — each picks its own model for that tier; you don't choose specific models. The card is currently at tier **${card.activeLevel}**. Set \`suggestedLevel\` in the MCP call — one of ${LEVEL_ORDER.join(", ")}. Lower it for clearly mechanical fixes (rename / copy / colour tweak), raise it for clearly harder/architectural work. When unsure, keep "${card.activeLevel}"; omit it to leave the tier unchanged.`
		: "";

	return `You are a senior reviewer performing an automated review.

## Task to review
${card.description ?? ""}${descAttachSection}${priorContext}

${renderReviewDiff(stat, fullDiff, card.baseRef, scope)}

${ITERATION_SCOPING_NOTE}

## What to check
${
	scope.isFollowUp
		? FOLLOWUP_REVIEW_FOCUS
		: `- Correctness: does it do what the task requires?
- Security: injection, auth bypass, data exposure, unsafe operations?
- Interface impact: grep callers of any changed function/type/export to confirm nothing breaks downstream
- Current iteration feedback: verify every issue / request under \`## New Feedback\` or \`## Current Iteration\` has been addressed in the diff
- Test coverage: only mention if tests exist and are missing coverage, or if existing tests are broken`
}

## How to work
Use your tools — grep for callers, read type definitions, check related modules. Don't rely only on the diff. The terminal output is observational — write findings as plain text without pass/fail words. Your only formal verdict is the \`status\` field in the MCP call below.${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}${runningAppSection}${levelAdjustSection}

## When you finish your review

1. Call the \`kanban_add_comment\` MCP tool with:
   - cardId: "${card.id}"
   - type: "${slot.id}"
   - status: "pass" / "fail" / "warning" / "skipped"
   - summary: your findings (specific, concise)
   - issues (optional): [{file, line, severity: "blocking" (must fix, fails pipeline) / "warning" (must fix, fails pipeline) / "info" (optional note, pipeline still passes), message}]
   - attachments (optional): [{type: "image" | "file", name, mimeType, path}]${slot.canAdjustLevel ? "\n   - suggestedLevel (optional): the tier the rework should run at (see above)" : ""}

This MCP call is required — without it the pipeline has no record of your verdict.`;
}

function buildOrchSystemPrompt(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	scope: ReviewDiffScope,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
	autoCommit = true,
	subtaskCards: RuntimeBoardCard[] = [],
): string {
	const commentType = slotCommentType(slot);
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";

	const orchDescAttachSection =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use Read tool to view):\n${attachmentLines(card.descriptionAttachments ?? [])}`
			: "";

	// Inline subtask context: id, description, latest dev status & each review
	// agent's latest verdict. Review comment types are slot ids (not fixed
	// code_review/qa), so surface every AI review type generically. Saves a
	// kanban_get_board roundtrip at runtime.
	const subtasksSection =
		subtaskCards.length > 0
			? subtaskCards
					.map((sub) => {
						const lines = [`### [${sub.id}] (${sub.columnId})`];
						if (sub.description) lines.push(sub.description);
						const latestByType = new Map<string, RuntimeReviewComment>();
						for (const c of sub.reviewComments ?? []) latestByType.set(c.type, c);
						const dev = latestByType.get("dev");
						if (dev) lines.push(`\n**Dev** · ${dev.status ?? "?"}: ${dev.summary}`);
						for (const [type, c] of latestByType) {
							if (type === "dev" || c.actor?.type !== "ai") continue;
							const issues = (c.issues ?? []).map((i) => `  - [${i.severity}] ${i.message}`).join("\n");
							lines.push(`\n**${type}** · ${c.status ?? "?"}: ${c.summary}${issues ? `\n${issues}` : ""}`);
						}
						return lines.join("\n");
					})
					.join("\n\n")
			: "(no subtasks)";

	return `You are an Orchestrator agent. All subtasks for a story have finished their dev and review workflows. Your job is to decide whether the story goal has been fully and correctly met across all subtasks.

## Story
**[${card.id}]**
${card.description ? `\n${card.description}\n` : ""}${orchDescAttachSection}

## Subtasks

${subtasksSection}${priorContext}

${renderReviewDiff(stat, fullDiff, card.baseRef, scope)}

${ITERATION_SCOPING_NOTE}

## What to evaluate

1. **Completeness** — does the diff cover everything in the story description?
2. **Integration** — if subtask A exposes an interface that subtask B consumes, do they actually match?
3. **Correctness** — given the review findings already shown above, are there unresolved issues that affect the story goal?
4. **Consistency** — are patterns, naming, data shapes, and behaviors consistent across subtasks?

You may use \`Read\` / \`grep\` on the worktree to verify, but everything you need to make a decision is already in this prompt — avoid unnecessary tool calls.

## Rules

- All data above is current; do NOT call \`kanban_get_board\` — it's redundant.
- You will run again after any flagged subtasks are fixed, so only pass when confident the story goal is met.
- Only flag subtasks for issues that affect the story goal. Skip minor style preferences or info-level findings already noted by the review agents.
- A flagged subtask without a specific, actionable comment blocks the dev agent — never leave the summary vague.
- **Choosing the right subtask**: reopen the one whose scope is most semantically responsible for the issue. All subtasks share one worktree, so the dev agent can edit any file regardless of which subtask you target.${!autoCommit ? "\n- **Auto-commit is disabled**: Subtask worktrees intentionally have uncommitted changes. Do NOT flag this." : ""}
- Your story-card summary must describe only what was built and whether it meets the story goal — nothing else.${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}

## Decision tree

Make ONE pass/fail decision per orchestrator run:

1. **PASS** — the combined implementation in the diff above meets the story goal AND all current-iteration feedback has been addressed. Call the \`kanban_add_comment\` MCP tool once on the **story card** with \`type: "${commentType}"\`, \`status: "pass"\`, and a 2–4 sentence summary of what was built. Stop.

2. **FAIL** — something is missing, wrong, or unresolved. For **each** subtask that needs rework, call the \`kanban_add_comment\` MCP tool on the **subtask card** with \`type: "orch"\`, \`status: "fail"\`, and an exact actionable summary + \`issues\` array. Then call the \`kanban_add_comment\` MCP tool once on the **story card** with \`type: "${commentType}"\`, \`status: "fail"\`, summarising which subtasks need rework and why (1–2 sentences). Do NOT call \`kanban_move_card\` — the system reopens subtasks automatically based on your comments.

These MCP calls are required — without them the pipeline has no record of your decision.`;
}

function buildPlanSystemPrompt(
	card: RuntimeBoardCard,
	customPrompt: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
	priorContext = "",
): string {
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";
	const descAttachSection =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use Read tool to view):\n${attachmentLines(card.descriptionAttachments ?? [])}`
			: "";

	// Re-plan: a plan already exists and the card was reopened. Show the previous
	// plan + the reopen feedback so the agent revises rather than starting blind.
	const existingPlan = card.plan?.trim();
	const replanSection = existingPlan
		? `\n\n## You are RE-PLANNING
This card already has a plan and was reopened for rework. Revise the plan to address the feedback below — keep the parts that still hold, change what's wrong, and don't restart from scratch.

### Previous plan
${existingPlan}${priorContext}`
		: "";

	return `You are a planning agent. You do NOT write code — you produce an implementation plan that the dev agent will follow.

## Task to plan
${card.description ?? ""}${descAttachSection}${replanSection}

## How to work
Explore the codebase with your tools (grep, read files) so the plan is grounded in the real code, not assumptions. Identify the files to change, the approach, edge cases, and how the work should be verified.${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}

## When you finish

Call the \`kanban_set_plan\` MCP tool with:
   - cardId: "${card.id}"
   - plan: a concrete, step-by-step implementation plan (files to change, approach, edge cases, verification steps)

This MCP call is required — the dev agent reads this plan to implement the task. It fully replaces any previous plan.`;
}

// Options the scheduler passes to run the one-shot plan agent. A subset of
// ReviewPipelineOptions — the plan phase runs before dev, not in the review loop.
export interface PlanPhaseOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	mcpBinary: { command: string; args: string[] };
	worktreePath: string;
	stateHub: RuntimeStateHub;
	secrets: RuntimeProjectSecret[];
	systemPrompt?: string;
	registerStopCallback: ReviewPipelineOptions["registerStopCallback"];
	registerLiveProcess: ReviewPipelineOptions["registerLiveProcess"];
	isManuallyStopped: () => boolean;
}

// Run the one-shot plan agent in the card's worktree. The agent persists its
// output via the kanban_set_plan MCP tool; the dev agent then reads card.plan.
export async function runPlanPhase(
	card: RuntimeBoardCard,
	slot: WorkflowSlot,
	options: PlanPhaseOptions,
): Promise<void> {
	const { workspaceId, stateHub, worktreePath } = options;
	const cfg: SlotModelConfig = card.modelConfig?.[slot.id] ?? {
		pairs: slot.pairs,
		mode: slot.mode,
	};
	const pair = resolvePair(cfg, card.activeLevel);
	const agentId = pair.binary;
	const streamId = `${card.id}-${slot.id}-${Date.now()}`;
	const customPrompt = resolvePromptText(slot.prompt, options.repoPath);
	// On a re-plan, fold in the reopen feedback so the agent revises the prior plan.
	const priorContext = card.plan?.trim() ? formatPriorComments(card) : { text: "", files: [] as string[] };

	const rawSystemPrompt = buildPlanSystemPrompt(
		card,
		customPrompt,
		options.secrets,
		options.systemPrompt,
		priorContext.text,
	);
	const memContext = buildMemoryContext(workspaceId);
	const withMemory = memContext ? `${memContext}\n\n${rawSystemPrompt}` : rawSystemPrompt;
	const systemPrompt =
		agentId === "cursor"
			? `${withMemory}\n\nAfter calling \`kanban_set_plan\`, call the \`task_complete\` MCP tool to signal that you are done.`
			: withMemory;

	const mcpConfigPath = !isPluginConfigAgent(agentId) && agentId !== "cursor" ? getMcpConfigPath(streamId) : undefined;
	const hookServerPort =
		agentId === "codex" || isPluginConfigAgent(agentId) || agentId === "cursor"
			? getServerPort(options.serverUrl)
			: undefined;
	const mcpServer =
		agentId === "codex" || isPluginConfigAgent(agentId) || agentId === "cursor"
			? buildWhippedMcpServerSpec(options.mcpBinary, options.serverUrl, workspaceId, agentId)
			: undefined;

	if (agentId === "claude" && mcpConfigPath) {
		await writeClaudeMcpConfig(options.mcpBinary, options.serverUrl, workspaceId, agentId, mcpConfigPath).catch(
			() => {},
		);
	}

	await appendActivityLog(workspaceId, card.id, `${slot.name} running (${agentId})`);
	await appendTerminalSession(workspaceId, card.id, {
		streamId,
		type: slot.id,
		startedAt: Date.now(),
		agentId,
		state: "running",
	});
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	const secretsEnv = buildSecretsEnv(options.secrets);

	logger.info(`[plan:${streamId}] Starting plan agent "${agentId}"`);
	await runAgentOnce(
		agentId,
		"Start planning.",
		worktreePath,
		workspaceId,
		streamId,
		stateHub,
		options.registerStopCallback,
		options.registerLiveProcess,
		mcpConfigPath,
		systemPrompt,
		priorContext.files,
		secretsEnv,
		pair.effort,
		hookServerPort,
		mcpServer,
		pair.model,
		slot.type,
		undefined,
	);

	const stopped = options.isManuallyStopped();
	logger.info(`[plan:${streamId}] Plan agent finished — manuallyStopped=${stopped}`);
	await endTerminalSession(workspaceId, card.id, streamId, Date.now(), stopped ? "stopped" : "completed");
	if (!stopped) {
		await appendActivityLog(workspaceId, card.id, `${slot.name}: plan saved`);
	}
	stateHub.broadcastWorkspaceUpdate(workspaceId);
}

async function getMcpComment(
	workspaceId: string,
	cardId: string,
	afterTime: number,
	type: string,
): Promise<RuntimeReviewComment | null> {
	try {
		const board = await loadBoard(workspaceId);
		const card = board.cards[cardId];
		const comments = card?.reviewComments ?? [];
		for (let i = comments.length - 1; i >= 0; i--) {
			const c = comments[i]!;
			if (c.type === type && c.createdAt >= afterTime) return c;
		}
		return null;
	} catch (err) {
		logger.error({ err }, `[review] getMcpComment failed for card ${cardId} type ${type}:`);
		return null;
	}
}

interface ParsedAgentJson {
	status?: RuntimeReviewComment["status"];
	summary?: string;
	issues?: RuntimeReviewComment["issues"];
	metadata?: Record<string, unknown>;
}

export function tryParseAgentJson(output: string): ParsedAgentJson | null {
	// Try to extract a JSON object from agent output
	const jsonMatch = output.match(/\{[\s\S]*\}/);
	if (!jsonMatch) return null;
	try {
		const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
		if (typeof obj !== "object" || obj === null) return null;
		const result: ParsedAgentJson = {};
		if (typeof obj.status === "string" && ["pass", "fail", "warning", "skipped"].includes(obj.status)) {
			result.status = obj.status as RuntimeReviewComment["status"];
		}
		if (typeof obj.summary === "string") result.summary = obj.summary;
		if (Array.isArray(obj.issues)) result.issues = obj.issues as RuntimeReviewComment["issues"];
		if (typeof obj.metadata === "object" && obj.metadata !== null)
			result.metadata = obj.metadata as Record<string, unknown>;
		return Object.keys(result).length > 0 ? result : null;
	} catch {
		return null;
	}
}

// Re-export for use in scheduler.ts — saveAttachment is needed there too
export { saveAttachment };
