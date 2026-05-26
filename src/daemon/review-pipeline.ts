import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	buildOveremployedMcpServerSpec,
	buildTaskHookEnv,
	CLAUDE_TASK_SETTINGS_PATH,
	cleanupCursorConfigDir,
	cleanupOpencodeFiles,
	CURSOR_CONFIG_DIR_ENV,
	getCursorConfigDir,
	getMcpConfigPath,
	getOpencodeConfigDir,
	getServerPort,
	OPENCODE_CONFIG_DIR_ENV,
	writeClaudeMcpConfig,
	writeCursorConfigFiles,
	writeOpencodeFiles,
} from "../agents/agent-hooks.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type {
	RuntimeBoardCard,
	RuntimeProjectSecret,
	RuntimeReviewComment,
	WorkflowSlot,
} from "../core/api-contract.js";
import { DEFAULT_GIT_INSTRUCTIONS } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { commitIfDirty, createGithubPR, pushBranch } from "../git/merge-operations.js";
import type { GithubClient } from "../github/github-client.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	appendActivityLog,
	appendTerminalSession,
	endTerminalSession,
	linkCommentToSession,
	loadBoard,
	moveCard,
	saveAttachment,
	saveTerminalBuffer,
	updateCard,
} from "../state/workspace-state.js";
import { getCardBranch, getWorktreePath } from "../worktree/worktree-manager.js";

interface ReviewPipelineOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	mcpBinary: { command: string; args: string[] };
	reviewSlots: WorkflowSlot[];
	maxAutoFixAttempts: number;
	stateHub: RuntimeStateHub;
	githubClient?: GithubClient;
	autoPR: boolean;
	autoCommit: boolean;
	secrets: RuntimeProjectSecret[];
	systemPrompt?: string;
	registerStopCallback: (streamId: string, callback: () => void) => () => void;
	registerLiveProcess: (streamId: string, process: AgentProcess) => () => void;
}

interface ReviewSlotResult {
	passed: boolean;
	comment: RuntimeReviewComment;
	storedViaMcp: boolean;
}

// Serialised QA queue — only one QA test runs at a time
const qaQueue: Array<() => Promise<void>> = [];
let qaRunning = false;

async function drainQaQueue(): Promise<void> {
	if (qaRunning) return;
	const next = qaQueue.shift();
	if (!next) return;
	qaRunning = true;
	try {
		await next();
	} finally {
		qaRunning = false;
		await drainQaQueue();
	}
}

function enqueueQA(fn: () => Promise<void>): void {
	qaQueue.push(fn);
	void drainQaQueue();
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
	const isResume = card.type !== "story" && lastTs?.state === "killed";
	const lastDevTs = card.terminalSessions
		?.slice()
		.reverse()
		.find((ts) => ts.type === "dev");
	const sessionStartedAt = lastDevTs?.startedAt ?? 0;

	logger.info(`[review] Starting review pipeline for "${card.title}" (${card.id})${isResume ? " — resuming" : ""}`);
	await appendActivityLog(workspaceId, card.id, "AI review started");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// When resuming, skip slots that already passed — stop skipping at the first failure/missing.
	let skipPassed = isResume;

	for (const slot of options.reviewSlots) {
		const customPrompt = slot.prompt ?? "";
		const streamId = `${card.id}-${slot.id}-${runId}`;

		if (skipPassed) {
			const commentType = slot.type === "custom" ? slot.id : slot.type;
			const lastSlotComment = [...(card.reviewComments ?? [])].reverse().find((c) => c.type === commentType);
			// Only skip if the passing comment belongs to THIS session (not a previous run).
			const alreadyPassed = lastSlotComment
				? lastSlotComment.createdAt >= sessionStartedAt &&
					lastSlotComment.status !== "fail" &&
					!(lastSlotComment.issues?.some((i) => i.severity === "blocking") ?? false)
				: false;
			if (alreadyPassed) {
				logger.info(`[review] ${slot.name} already passed for "${card.title}" — skipping`);
				await appendActivityLog(workspaceId, card.id, `${slot.name}: already passed — skipping`);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				continue;
			}
			skipPassed = false; // found the first slot to run — run this and all remaining
		}

		await appendActivityLog(workspaceId, card.id, `${slot.name} running (${slot.agentBinary})`);
		await appendTerminalSession(workspaceId, card.id, {
			streamId,
			type: slot.id,
			startedAt: runId,
			agentId: slot.agentBinary,
			state: "running",
		});
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		// QA-type slots are serialized globally to avoid port/simulator conflicts
		let result: ReviewSlotResult;
		if (slot.type === "qa") {
			result = await new Promise<ReviewSlotResult>((resolve) => {
				enqueueQA(async () => {
					resolve(await runReviewSlot(slot, card, streamId, options, customPrompt));
				});
			});
		} else {
			result = await runReviewSlot(slot, card, streamId, options, customPrompt);
		}

		logger.info(`[review] ${slot.name} ${result.passed ? "PASSED" : "FAILED"} for "${card.title}"`);

		if (!result.passed) {
			await appendActivityLog(workspaceId, card.id, `${slot.name}: FAIL`);
			if (!result.storedViaMcp) await persistComment(workspaceId, card, result.comment);
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
	// Orch slots use the story card's shared worktree (story is the worktree owner).
	// Falls back to repoPath if that worktree no longer exists.
	// Non-orch slots use the shared worktree when sharedWorktreeId is set.
	const orchWorktreePath = getWorktreePath(card.id);
	const worktreePath =
		slot.type === "orch"
			? existsSync(orchWorktreePath)
				? orchWorktreePath
				: options.repoPath
			: getWorktreePath(card.sharedWorktreeId ?? card.id);
	const stat = getGitStat(worktreePath, card.baseRef);
	const fullDiff = getGitFullDiff(worktreePath, card.baseRef);
	const context = formatPriorComments(card);
	const rawSystemPrompt = buildReviewSlotSystemPrompt(
		slot,
		card,
		stat,
		fullDiff,
		customPrompt,
		context.text,
		options.secrets,
		options.systemPrompt,
		options.autoCommit,
	);
	// Cursor Agent CLI does not fire a settings.json stop hook reliably.
	// Tell it to call the task_complete MCP tool explicitly when done.
	const systemPrompt =
		slot.agentBinary === "cursor"
			? rawSystemPrompt + "\n\nAfter calling `kanban_add_comment`, call the `task_complete` MCP tool to signal that you are done."
			: rawSystemPrompt;
	const triggerWord = getSlotTriggerWord(slot.type);

	const mcpConfigPath =
		slot.agentBinary !== "opencode" && slot.agentBinary !== "cursor" ? getMcpConfigPath(streamId) : undefined;
	const hookServerPort =
		slot.agentBinary === "codex" || slot.agentBinary === "opencode" || slot.agentBinary === "cursor"
			? getServerPort(options.serverUrl)
			: undefined;
	const mcpServer =
		slot.agentBinary === "codex" || slot.agentBinary === "opencode" || slot.agentBinary === "cursor"
			? buildOveremployedMcpServerSpec(options.mcpBinary, options.serverUrl, workspaceId, slot.agentBinary)
			: undefined;

	if (slot.agentBinary === "claude" && mcpConfigPath) {
		await writeClaudeMcpConfig(
			options.mcpBinary,
			options.serverUrl,
			workspaceId,
			slot.agentBinary,
			mcpConfigPath,
		).catch(() => {});
	}
	const startTime = Date.now();
	logger.info(`[review:${streamId}] Spawning ${slot.name} agent (${slot.agentBinary}) for "${card.title}"`);
	const secretsEnv = buildSecretsEnv(options.secrets);
	const output = await runAgentOnce(
		slot.agentBinary,
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
		slot.effort,
		hookServerPort,
		mcpServer,
		slot.model,
	);
	logger.info(`[review:${streamId}] ${slot.name} agent done (${Date.now() - startTime}ms)`);

	// Comment type: use slot.type for built-ins, slot.id for custom
	const commentType = slot.type === "custom" ? slot.id : slot.type;
	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, commentType);
	if (mcpComment) {
		const endedAt = Date.now();
		const hasMustFixIssue = mcpComment.issues?.some((i) => i.severity === "blocking") ?? false;
		const passed = mcpComment.status !== "fail" && !hasMustFixIssue;
		await linkCommentToSession(workspaceId, card.id, mcpComment.createdAt, streamId);
		await endTerminalSession(workspaceId, card.id, streamId, endedAt, passed ? "completed" : "failed");
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	// Non-MCP fallback: try to parse JSON from output
	const parsed = tryParseAgentJson(output);
	const status =
		parsed?.status ?? (/(FAIL|REJECT|CRITICAL|BLOCKING|ERROR|CRASH|BROKEN)/i.test(output) ? "fail" : "pass");
	const hasMustFixIssue = parsed?.issues?.some((i: { severity: string }) => i.severity === "blocking") ?? false;
	const passed = status !== "fail" && !hasMustFixIssue;
	const nowFallback = Date.now();
	const comment: RuntimeReviewComment = {
		type: commentType,
		actor: { type: "ai", id: slot.agentBinary },
		status: status as RuntimeReviewComment["status"],
		createdAt: nowFallback,
		streamId,
		summary: parsed?.summary ?? output.trim(),
		issues: parsed?.issues,
		metadata: parsed?.metadata,
	};
	await endTerminalSession(workspaceId, card.id, streamId, nowFallback, passed ? "completed" : "failed");
	return { passed, storedViaMcp: false, comment };
}

function getSlotTriggerWord(type: string): string {
	if (type === "code_review") return "Start Code Review.";
	if (type === "qa") return "Start QA.";
	return "Start.";
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
		logger.info(`[review] Orch review failed for story "${card.title}" → reopening flagged subtasks`);
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
			logger.warn(`[review] Orch failed for "${card.title}" but no subtask orch-fail comments found — propagating story comment to all subtasks`);
			const reloadedStory = orchBoard.cards[card.id];
			const storyOrchComment = reloadedStory?.reviewComments?.slice().reverse().find((c) => c.type === "orch" && c.status === "fail");
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
								summary: `[From orchestrator review of story "${card.title}"]\n\n${storyOrchComment.summary}`,
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
		`[review] Review failed for "${card.title}" (attempt ${newAttempts}/${maxAutoFixAttempts}) → ${destination}`,
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
	const { workspaceId, githubClient, stateHub, autoPR } = options;

	logger.info(`[review] Review passed for "${card.title}" → ready for human review`);

	if (githubClient && card.githubIssueUrl) {
		try {
			logger.info(`[review] Posting GitHub comment on issue for "${card.title}"`);
			await githubClient.postComment(
				card.githubIssueUrl,
				`✅ AI review passed for task "${card.title}". Ready for human review.`,
			);
			logger.info(`[review] GitHub comment posted for "${card.title}"`);
		} catch (err) {
			logger.error({ err }, `[review] Failed to post GitHub comment for "${card.title}":`);
		}
	}

	await moveCard(workspaceId, card.id, "ready_for_review");
	await appendActivityLog(workspaceId, card.id, "All reviews passed → moved to Ready for Review");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// subtasks (type:"subtask") skip autoPR — the story card creates the PR after orch passes.
	// Standalone dependent tasks (type:"task" with sharedWorktreeId) still create their own PR.
	if (autoPR && card.type !== "subtask") {
		const effectiveWorktreeId = card.sharedWorktreeId ?? card.id;
		const worktreePath = getWorktreePath(effectiveWorktreeId);
		const taskBranch = getCardBranch(card);
		const githubToken = options.secrets.find((s) => s.key === "GITHUB_TOKEN")?.value;
		if (!githubToken) {
			logger.warn(`[review] Auto PR skipped for "${card.title}" — GITHUB_TOKEN not set in project secrets`);
			await appendActivityLog(
				workspaceId,
				card.id,
				"Auto PR skipped — GITHUB_TOKEN not set in project Settings > Secrets.",
			);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}
		try {
			logger.info(`[review] Auto PR: commit → push → create for "${card.title}" (branch: ${taskBranch})`);
			await commitIfDirty(worktreePath, card.pr?.title ?? card.title);
			await pushBranch(worktreePath, taskBranch);
			const devSummary =
				[...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.summary ?? card.description;
			const prTitle = card.pr?.title ?? card.title;
			const prDescription = card.pr?.description ?? devSummary;
			const prUrl = await createGithubPR(worktreePath, prTitle, prDescription, card.baseRef, githubToken);
			logger.info(`[review] Auto PR created: ${prUrl}`);
			await updateCard(workspaceId, card.id, { pr: { ...card.pr, url: prUrl } });
			await appendActivityLog(workspaceId, card.id, `Auto PR created → ${prUrl}`);
		} catch (err) {
			logger.error({ err }, `[review] Auto PR failed for "${card.title}":`);
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
): Promise<string> {
	if (agentId === "opencode" && hookServerPort != null && mcpServer) {
		void writeOpencodeFiles(streamId, hookServerPort, mcpServer, { appendSystemPrompt }).catch(() => {});
	}
	if (agentId === "cursor" && hookServerPort != null && mcpServer) {
		void writeCursorConfigFiles(streamId, hookServerPort, mcpServer).catch(() => {});
	}

	return new Promise((resolve) => {
		let output = "";
		let unregisterProcess: (() => void) | undefined;

		const unregister = registerStopCallback(streamId, () => {
			unregisterProcess?.();
			proc.kill();
			void saveTerminalBuffer(workspaceId, streamId, output);
			if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
			if (agentId === "opencode") void cleanupOpencodeFiles(streamId);
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
				...(agentId === "opencode" ? { [OPENCODE_CONFIG_DIR_ENV]: getOpencodeConfigDir(streamId) } : {}),
				...(agentId === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(streamId) } : {}),
			},
			hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			hookServerPort: agentId === "codex" ? hookServerPort : undefined,
			mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
			mcpServer: agentId === "codex" ? mcpServer : undefined,
			appendSystemPrompt: agentId !== "opencode" ? appendSystemPrompt : undefined,
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
				if (agentId === "opencode") void cleanupOpencodeFiles(streamId);
				if (agentId === "cursor") void cleanupCursorConfigDir(streamId);
				resolve(output);
			},
		});

		unregisterProcess = registerLiveProcess(streamId, proc);
	});
}

function git(args: string[], cwd: string): string {
	return spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).stdout?.trim() ?? "";
}

function readFileSafe(filePath: string): string {
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return "";
	}
}

// Stat summary only — always small, safe to include in every prompt
function getGitStat(worktreePath: string, baseRef: string): string {
	const parts = [
		git(["diff", "--stat", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "--stat", "--cached"], worktreePath),
		git(["diff", "--stat"], worktreePath),
	].filter(Boolean);

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	if (newUntracked.length > 0) {
		parts.push(`New files:\n${newUntracked.map((f) => `  ${f}`).join("\n")}`);
	}

	return parts.join("\n") || "(no changes detected — agent may not have committed yet)";
}

// Full diff + new file contents — can be huge for large changesets
function getGitFullDiff(worktreePath: string, baseRef: string): string {
	const sections: string[] = [];

	const diffParts = [
		git(["diff", "-U15", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "-U15", "--cached"], worktreePath),
		git(["diff", "-U15"], worktreePath),
	].filter(Boolean);

	if (diffParts.length > 0) {
		sections.push(`\`\`\`diff\n${diffParts.join("\n")}\n\`\`\``);
	}

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	if (newUntracked.length > 0) {
		const newFileContents: string[] = [];
		for (const file of newUntracked) {
			const content = readFileSafe(join(worktreePath, file));
			const ext = file.split(".").pop() ?? "";
			newFileContents.push(content ? `### ${file}\n\`\`\`${ext}\n${content}\n\`\`\`` : `### ${file} (unreadable)`);
		}
		sections.push(`New files (full content):\n\n${newFileContents.join("\n\n")}`);
	}

	return sections.join("\n\n");
}

function formatPriorComments(card: RuntimeBoardCard): { text: string; files: string[] } {
	const comments = card.reviewComments ?? [];
	if (comments.length === 0) return { text: "", files: [] };

	const allFiles: string[] = [];
	const lines = comments.map((c) => {
		const typeLabel =
			c.type === "human" ? "Human Feedback" : c.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
		const actorId = c.actor.id;
		const statusLabel = c.status?.toUpperCase() ?? "";
		const hasMustFix = c.issues?.some((i) => i.severity === "blocking" || i.severity === "warning") ?? false;
		const failedRound = c.status === "fail" || hasMustFix;

		const parts: string[] = [
			`### ${typeLabel} · ${actorId}${statusLabel ? ` · ${statusLabel}` : ""}${failedRound ? " ⚠ MUST FIX BEFORE PROCEEDING" : ""}`,
		];
		parts.push(c.summary);

		if (c.issues?.length) {
			for (const issue of c.issues) {
				const loc = issue.file ? `${issue.file}${issue.line != null ? `:${issue.line}` : ""}` : "";
				parts.push(`- [${issue.severity}]${loc ? ` ${loc}` : ""} — ${issue.message}`);
			}
		}

		if (c.attachments?.length) {
			const attLines = c.attachments.map((att) => `  - ${att.name}: ${att.path}`).join("\n");
			parts.push(`Attached files (use Read tool to view):\n${attLines}`);
		}

		if (c.metadata && Object.keys(c.metadata).length > 0) {
			for (const [k, v] of Object.entries(c.metadata)) {
				parts.push(`${k}: ${String(v)}`);
			}
		}

		return parts.join("\n");
	});

	return {
		text: `\n\n---\n\n## Prior Review History\n\n${lines.join("\n\n")}`,
		files: allFiles,
	};
}

const INLINE_DIFF_LIMIT = 8000;

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
	const stat = worktreePath ? getGitStat(worktreePath, statBase) : null;
	const fullDiff = worktreePath ? getGitFullDiff(worktreePath, statBase) : "";
	const diffSection = fullDiff
		? fullDiff.length <= INLINE_DIFF_LIMIT
			? `\n\n## Diff (vs ${statBase})\n${fullDiff}`
			: `\n\n## Diff (vs ${statBase})\nLarge changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${statBase}...HEAD\` and read individual files to explore.`
		: "";
	const statSection = stat ? `\n\n## Current worktree state (vs ${statBase})\n${stat}${diffSection}` : "";

	const descAttachNote =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use the Read tool to view each one):\n${card.descriptionAttachments?.map((a) => `- ${a.name}: ${a.path}`).join("\n")}`
			: "";
	parts.push(
		`## Task: ${card.title}${card.description ? `\n\n${card.description}` : ""}${descAttachNote}${statSection}${context.text}`,
	);

	if (parentCards.length > 0) {
		const parentSummaries = parentCards
			.map((p) => {
				const devComment = [...(p.reviewComments ?? [])].reverse().find((c) => c.type === "dev");
				if (!devComment) return null;
				return `### ${p.title}\n${devComment.summary}`;
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
				return `### ${s.title}\n${devComment.summary}`;
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

If there are prior review comments above with issues listed, you MUST address ALL of them before finishing — including info-level ones. Do not skip any issue regardless of severity.

When you finish your work:
${commitInstruction}
2. Call the \`kanban_set_pr_meta\` MCP tool with:
   - cardId: "${card.id}"
   - title: PR title following the git conventions below
   - description: PR description body following the git conventions below
   This is what the daemon will use when it creates the PR. Skip this call only if you genuinely have no code changes to ship.${priorPrSection}

3. Call the \`kanban_add_comment\` MCP tool with:
   - cardId: "${card.id}"
   - type: "dev"
   - status: "pass" if successful, "fail" if you were unable to complete the task
   - summary: 2–5 sentences for the next reviewer agent in this pipeline (NOT the PR description — that already went to set_pr_meta). Mention key decisions and any known limitations.`);

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
	secrets: RuntimeProjectSecret[] = [],
	systemPrompt?: string,
	autoCommit = true,
): string {
	switch (slot.type) {
		case "code_review":
			return buildCodeReviewSystemPrompt(slot, card, stat, fullDiff, customPrompt, priorContext, secrets, systemPrompt);
		case "qa":
			return buildQASystemPrompt(slot, card, stat, fullDiff, customPrompt, priorContext, secrets, systemPrompt);
		case "orch":
			return buildOrchSystemPrompt(slot, card, stat, fullDiff, customPrompt, priorContext, secrets, systemPrompt, autoCommit);
		default:
			return buildCustomSystemPrompt(slot, card, stat, fullDiff, customPrompt, priorContext, secrets, systemPrompt);
	}
}

function buildCodeReviewSystemPrompt(
	_slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
): string {
	const diffSection =
		fullDiff.length <= INLINE_DIFF_LIMIT
			? `Git diff:\n${fullDiff}`
			: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` and read individual files to explore — start with the stat above to decide where to focus.`;
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";

	const descAttachSection =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use Read tool to view):\n${card.descriptionAttachments?.map((a) => `- ${a.name}: ${a.path}`).join("\n")}`
			: "";

	return `You are a senior code reviewer performing an automated review.

## Task to review
"${card.title}"
${card.description ? `\n${card.description}` : ""}${descAttachSection}${priorContext}

## Changed files
${stat}

## Diff
${diffSection}

## What to check
- Correctness: does it do what the task requires?
- Security: injection, auth bypass, data exposure, unsafe operations?
- Interface impact: grep callers of any changed function/type/export to confirm nothing breaks downstream
- Previous feedback: verify all prior review failures and human feedback are addressed
- Test coverage: only mention if tests exist and are missing coverage, or if existing tests are broken

## How to work
Use your tools — grep for callers, read type definitions, check related modules. Don't rely only on the diff.

## How to report
Write your findings to the terminal as plain text. Do NOT include pass/fail verdict words in your terminal output; those go only in the \`kanban_add_comment\` call.

Then call \`kanban_add_comment\` with cardId: "${card.id}", type: "code_review", status: "pass"/"fail"/"warning", summary: your findings (specific, concise), and optionally issues: [{file, line, severity: "blocking" (must fix, fails pipeline) / "warning" (must fix, fails pipeline) / "info" (optional note, pipeline still passes), message}].${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}`;
}

function buildQASystemPrompt(
	_slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
): string {
	const diffSection =
		fullDiff.length <= INLINE_DIFF_LIMIT
			? `Git diff:\n${fullDiff}`
			: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` to explore.`;
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";

	const qaDescAttachSection =
		(card.descriptionAttachments?.length ?? 0) > 0
			? `\n\n**Attached files** (use Read tool to view):\n${card.descriptionAttachments?.map((a) => `- ${a.name}: ${a.path}`).join("\n")}`
			: "";

	return `You are a QA engineer performing automated testing.

## Task to test
"${card.title}"
${card.description ? `\n${card.description}` : ""}${qaDescAttachSection}${priorContext}

## Changed files
${stat}

## Diff
${diffSection}

## What to do
1. Identify the app type (web, API, React Native/Expo, library, etc.)
2. Run the appropriate tests — existing test suite, TypeScript checks, Playwright, HTTP requests, etc.
3. Verify previous QA failures and human feedback have been addressed

## How to report
Write your findings to the terminal as plain text. Do NOT include pass/fail verdict words in your terminal output; those go only in the \`kanban_add_comment\` call.

Then call \`kanban_add_comment\` with cardId: "${card.id}", type: "qa", status: "pass"/"fail"/"warning"/"skipped", summary: what you ran and the outcome, and optionally issues: [{file, line, severity: "blocking" (must fix, fails pipeline) / "warning" (must fix, fails pipeline) / "info" (optional, pipeline still passes), message}] and attachments: [{type: "image"|"file", name, mimeType, path}].${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}`;
}

function buildOrchSystemPrompt(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
	autoCommit = true,
): string {
	const subtaskIds = card.dependsOn ?? [];
	const commentType = slot.type === "custom" ? slot.id : slot.type;
	const custom = customPrompt.trim() ? `\n\n## Additional instructions\n\n${customPrompt.trim()}` : "";
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";
	const diffSection =
		fullDiff.length <= INLINE_DIFF_LIMIT
			? `Git diff:\n${fullDiff}`
			: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` and read individual files to explore — start with the stat above to decide where to focus.`;

	return `You are an Orchestrator agent. All subtasks for a story have finished their dev and review workflows. Your job is to decide whether the story goal has been fully and correctly met across all subtasks.

## Story
**[${card.id}] ${card.title}**
${card.description ? `\n${card.description}\n` : ""}
## Subtasks
${subtaskIds.length > 0 ? subtaskIds.map((id) => `- ${id}`).join("\n") : "(none)"}
${priorContext}
## Changed files
${stat}

## Diff
${diffSection}

## Step 1 — Read the board and inspect the code
Call \`kanban_get_board\` to get the current state of all cards. For each subtask ID listed above, examine:
- Its **title and description** (what it was supposed to do)
- Its **review comments** (what was actually built, any CR/QA findings, and how issues were resolved)

The diff above shows the combined changes for this story's shared worktree. You may also use your tools (Read, grep) to inspect specific files and verify the implementation matches the story goal. If the diff is large, use \`git diff ${card.baseRef}...HEAD\` to explore.

## Step 2 — Evaluate against the story goal
Work through these checks:

1. **Completeness** — Does the combined implementation cover everything stated in the story description and acceptance criteria? Is anything missing?
2. **Integration** — Do the subtasks connect correctly? If subtask A exposes an endpoint/type/function that subtask B consumes, do the interfaces actually match?
3. **Correctness** — Based on what the CR and QA agents reported and what you see in the diff, are there unresolved issues that affect the story goal?
4. **Consistency** — Are patterns, naming, data shapes, and behaviors consistent across subtasks?

## Step 3 — Act

### ✅ Story goal is fully met
Call \`kanban_add_comment\` on the **story card** (${card.id}):
\`\`\`
type: "${commentType}"
status: "pass"
summary: Confirm the story goal is met. Summarise what was built across all subtasks in 2–4 sentences. Note any design decisions or caveats worth recording for the human reviewer.
\`\`\`

### ❌ Rework needed
For **each subtask that needs changes**, call \`kanban_add_comment\` on that **subtask card**:
\`\`\`
type: "orch"
status: "fail"
summary: Exact description of what is wrong and what to change. Reference specific files, functions, endpoints, or field names. The dev agent will read this as its only instruction — be precise enough that no further clarification is needed.
issues: [{ severity: "blocking", message: "..." }]  // one issue per distinct problem
\`\`\`

Do NOT call \`kanban_move_card\` — the system moves subtasks automatically based on your comments.

Then call \`kanban_add_comment\` on the **story card** (${card.id}):
\`\`\`
type: "${commentType}"
status: "fail"
summary: Which subtasks need rework and the overall reason (1–2 sentences).
\`\`\`

## Rules
- You will run again after subtasks are fixed, so only pass when you are confident the story goal is met
- Only flag subtasks for issues that affect the story goal — do not flag for minor style preferences or issues the CR/QA agent already marked as info-only
- Never flag a subtask without a specific, actionable comment — vague feedback blocks the dev agent
- **Choosing the right subtask**: Reopen the subtask whose work scope is most directly responsible for the issue. Since all subtasks share the same worktree directory, the dev agent can fix any file regardless of which subtask you target — pick the one where the fix semantically belongs.${!autoCommit ? "\n- **Auto-commit is disabled**: Subtask worktrees intentionally have uncommitted changes. Do NOT flag this." : ""}
- Your pass/fail summary must describe only what was built and whether it meets the story goal — nothing else.${custom}${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}`;
}

function buildCustomSystemPrompt(
	slot: WorkflowSlot,
	card: RuntimeBoardCard,
	stat: string,
	fullDiff: string,
	customPrompt: string,
	priorContext: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
): string {
	const diffSection =
		fullDiff.length <= INLINE_DIFF_LIMIT
			? `Git diff:\n${fullDiff}`
			: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` to explore.`;
	const secretsSection = buildSecretsSection(secrets);
	const projectContext = systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : "";

	return `You are ${slot.name}, an automated review agent.

## Task to review
"${card.title}"
${card.description ? `\n${card.description}` : ""}${priorContext}

## Changed files
${stat}

## Diff
${diffSection}

## Instructions
${customPrompt.trim()}

Write your findings to the terminal as plain text. Do NOT include pass/fail verdict words in your terminal output; those go only in the \`kanban_add_comment\` call.

Then call \`kanban_add_comment\` with cardId: "${card.id}", type: "${slot.id}", status: "pass"/"fail"/"warning"/"skipped", summary: your findings, and optionally issues: [{file, line, severity: "blocking" (must fix, fails pipeline) / "warning" (must fix, fails pipeline) / "info" (optional note, pipeline still passes), message}].${secretsSection ? `\n\n${secretsSection}` : ""}${projectContext}`;
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

// ─── Parent reopen cascade ────────────────────────────────────────────────────

interface CascadeOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	mcpBinary: { command: string; args: string[] };
	stateHub: RuntimeStateHub;
	secrets: RuntimeProjectSecret[];
	registerStopCallback: ReviewPipelineOptions["registerStopCallback"];
	registerLiveProcess: ReviewPipelineOptions["registerLiveProcess"];
	onChildReset?: (child: RuntimeBoardCard) => Promise<void>;
}

export async function runParentReopenCascade(
	parentCard: RuntimeBoardCard,
	childCards: RuntimeBoardCard[],
	options: CascadeOptions,
): Promise<void> {
	const { workspaceId, repoPath, mcpBinary, serverUrl, stateHub, secrets, registerStopCallback, registerLiveProcess } =
		options;
	const streamId = `${parentCard.id}-cascade-${Date.now()}`;

	const mcpConfigPath = getMcpConfigPath(streamId);
	await writeClaudeMcpConfig(mcpBinary, serverUrl, workspaceId, "claude", mcpConfigPath).catch(() => {});

	const parentBranch = getCardBranch(parentCard);
	const systemPrompt = buildCascadeSystemPrompt(parentCard, parentBranch, childCards);

	logger.info(`[cascade] Spawning cascade agent for parent "${parentCard.title}" (${childCards.length} children)`);

	await appendTerminalSession(workspaceId, parentCard.id, {
		streamId,
		type: "cascade",
		startedAt: Date.now(),
		state: "running",
	});
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	await runAgentOnce(
		"claude",
		"Evaluate each child ticket and take the appropriate action.",
		repoPath,
		workspaceId,
		streamId,
		stateHub,
		registerStopCallback,
		registerLiveProcess,
		mcpConfigPath,
		systemPrompt,
		undefined,
		buildSecretsEnv(secrets),
		"low",
	);

	await endTerminalSession(workspaceId, parentCard.id, streamId, Date.now(), "completed");
	logger.info(`[cascade] Cascade agent done for parent "${parentCard.title}"`);
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// Recursively cascade on any children that were reset to todo
	if (options.onChildReset) {
		const afterBoard = await loadBoard(workspaceId);
		const resetChildren = childCards.filter((child) => afterBoard.cards[child.id]?.columnId === "todo");
		for (const child of resetChildren) {
			logger.info(`[cascade] Recursing into reset child "${child.title}"`);
			await options.onChildReset(child);
		}
	}
}

function buildCascadeSystemPrompt(
	parentCard: RuntimeBoardCard,
	parentBranch: string,
	childCards: RuntimeBoardCard[],
): string {
	const comments = parentCard.reviewComments ?? [];

	const lastDevIdx = (() => {
		for (let i = comments.length - 1; i >= 0; i--) {
			if (comments[i]?.type === "dev") return i;
		}
		return -1;
	})();

	const allDevSummaries = comments
		.filter((c) => c.type === "dev")
		.map((c, i) => `Dev iteration ${i + 1}:\n${c.summary}`)
		.join("\n\n");

	const humanFeedback = comments
		.slice(lastDevIdx + 1)
		.filter((c) => c.actor.type !== "ai")
		.map((c) => c.summary)
		.filter(Boolean);

	const reopenReason = humanFeedback.length > 0 ? humanFeedback.join("\n") : "Parent task was reopened.";

	const childLines = childCards
		.map((child) => {
			const devComment = [...(child.reviewComments ?? [])].reverse().find((c) => c.type === "dev");
			return [
				`### [${child.id}] ${child.title} (${child.columnId})`,
				devComment ? `Dev summary: ${devComment.summary}` : "No dev work completed yet.",
			].join("\n");
		})
		.join("\n\n");

	return `You are a Kanban board manager. A parent task was reopened and you must decide what to do with its dependent child tasks.

All data you need is already provided below — do NOT call \`kanban_get_board\`. Proceed directly to taking action.


## Parent Task (Reopened)

**[${parentCard.id}] ${parentCard.title}**
${parentCard.description ? `\n${parentCard.description}\n` : ""}
**Reason for reopening (= the parent's new direction, not yet implemented):** ${reopenReason}
${allDevSummaries ? `\nParent's full dev history (OLD state — do NOT use this to judge conflicts, use the reopening reason above):\n${allDevSummaries}\n` : ""}

## Child Tasks to Evaluate

${childLines}

## Decision Rules

CRITICAL: The cascade runs BEFORE the parent's dev agent implements the feedback. The parent's existing dev summary reflects its OLD state — do NOT use it to evaluate conflicts. Use ONLY the **reason for reopening** (the human feedback) to determine what the parent is about to change. That is the parent's new direction.

**Reset a child when:**
- The reopening reason describes a change that directly conflicts with the child's purpose or existing work
- e.g. reason is "Remove username field", child's purpose is "Add username field" → direct conflict → reset
- e.g. reason is "Change the API response shape", child is building a UI that consumes that API → reset

**Leave a child alone when:**
- The reopening reason describes a change to something completely unrelated to the child's purpose
- e.g. reason is "Remove email field", child's purpose is "Add username field" → unrelated → leave alone
- e.g. reason is "Fix a bug in the payment module", child is working on user profiles → leave alone

The default is to **leave children alone**. Only reset when the reopening reason directly conflicts with what the child is doing.

## Steps for EACH child you decide to reset

1. Call \`kanban_stop_task\` if the child is in_progress.
2. Call \`kanban_add_comment\` on the **CHILD** card with:
   - type: "cascade"
   - status: "fail"
   - summary: Explain specifically what the parent changed and why this child's prior work needs to be revisited.
   - issues: include one blocking issue with severity "blocking" and message: "Run \`git merge ${parentBranch}\` FIRST (no fetch needed — all worktrees share the same git repo). After merging, implement this task's original goal on top of the parent's new state. The parent's changes are the new baseline — build on them, do not mirror them."
3. Call \`kanban_move_card\` to "todo" for that child.

After handling all children, call \`kanban_add_comment\` on the PARENT card (${parentCard.id}) with type "cascade" and a brief summary of each decision.`;
}
