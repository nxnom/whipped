import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commitIfDirty, createGithubPR, pushBranch } from "../git/merge-operations.js";
import { CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, getMcpConfigPath, writeClaudeMcpConfig } from "../agents/agent-hooks.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import type { WorkflowSlot, RuntimeBoardCard, RuntimeReviewComment } from "../core/api-contract.js";
import type { GithubClient } from "../github/github-client.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, loadBoard, moveCard, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { getWorktreeBranch, getWorktreePath, removeWorktreeAsync } from "../worktree/worktree-manager.js";
import { logger } from "../core/logger.js";

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
	registerStopCallback: (streamId: string, callback: () => void) => (() => void);
	registerLiveProcess: (streamId: string, process: AgentProcess) => (() => void);
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

	logger.info(`[review] Starting review pipeline for "${card.title}" (${card.id})`);
	await updateSession(workspaceId, card.id, { state: "review_in_progress" });
	await appendActivityLog(workspaceId, card.id, "AI review started");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// Reload card so we have the latest reviewComments including any dev summary the agent may
	// have stored via MCP just before the Stop hook fired.
	const freshBoard = await loadBoard(workspaceId);
	card = freshBoard.cards[card.id] ?? card;

	for (const slot of options.reviewSlots) {
		const customPrompt = slot.prompt ?? "";
		const streamId = `${card.id}-${slot.id}-${runId}`;

		await appendActivityLog(workspaceId, card.id, `${slot.name} running (${slot.agentBinary})`);
		await appendTerminalSession(workspaceId, card.id, { streamId, type: slot.id, startedAt: runId });
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		// QA-type slots are serialized globally to avoid port/simulator conflicts
		let result: ReviewSlotResult;
		if (slot.type === "qa") {
			result = await new Promise<ReviewSlotResult>((resolve) => {
				enqueueQA(async () => { resolve(await runReviewSlot(slot, card, streamId, options, customPrompt)); });
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
	const worktreePath = getWorktreePath(card.id);
	const stat = getGitStat(worktreePath, card.baseRef);
	const fullDiff = slot.type !== "qa" ? getGitFullDiff(worktreePath, card.baseRef) : "";
	const systemPrompt = buildReviewSlotSystemPrompt(slot, card, stat, fullDiff, customPrompt);
	const triggerWord = getSlotTriggerWord(slot.type);

	const mcpConfigPath = getMcpConfigPath(streamId);
	await writeClaudeMcpConfig(options.mcpBinary, options.serverUrl, workspaceId, slot.agentBinary, mcpConfigPath).catch(() => {});
	const startTime = Date.now();
	logger.info(`[review:${streamId}] Spawning ${slot.name} agent (${slot.agentBinary}) for "${card.title}"`);
	const output = await runAgentOnce(slot.agentBinary, triggerWord, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, mcpConfigPath, systemPrompt);
	logger.info(`[review:${streamId}] ${slot.name} agent done (${Date.now() - startTime}ms)`);

	// Comment type: use slot.type for built-ins, slot.id for custom
	const commentType = slot.type === "custom" ? slot.id : slot.type;
	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, commentType);
	if (mcpComment) {
		const passed = mcpComment.passed ?? !/(FAIL|REJECT|CRITICAL|BLOCKING|ERROR|CRASH|BROKEN)/i.test(mcpComment.content);
		return { passed, comment: mcpComment, storedViaMcp: true };
	}
	const passed = !/(FAIL|REJECT|CRITICAL|BLOCKING|ERROR|CRASH|BROKEN)/i.test(output);
	return { passed, storedViaMcp: false, comment: { type: commentType, agent: slot.agentBinary, content: output, createdAt: Date.now() } };
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

async function handleReviewFailure(
	card: RuntimeBoardCard,
	options: ReviewPipelineOptions,
): Promise<void> {
	const { workspaceId, maxAutoFixAttempts, stateHub } = options;
	const newAttempts = card.autoFixAttempts + 1;
	const destination = newAttempts >= maxAutoFixAttempts ? "blocked" : "reopened";

	logger.info(`[review] Review failed for "${card.title}" (attempt ${newAttempts}/${maxAutoFixAttempts}) → ${destination}`);
	await updateCard(workspaceId, card.id, { autoFixAttempts: newAttempts });
	await moveCard(workspaceId, card.id, destination);
	await appendActivityLog(
		workspaceId,
		card.id,
		destination === "blocked"
			? `Max fix attempts reached (${newAttempts}) → moved to Blocked`
			: `Review failed (attempt ${newAttempts}/${maxAutoFixAttempts}) → moved to Reopened`,
	);
	await updateSession(workspaceId, card.id, { state: "idle" });
	if (destination === "blocked") void removeWorktreeAsync(card.id, options.repoPath);
	stateHub.broadcastWorkspaceUpdate(workspaceId);
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
	await updateSession(workspaceId, card.id, { state: "awaiting_review", completedAt: Date.now() });
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	if (autoPR && !card.githubPrUrl) {
		const worktreePath = getWorktreePath(card.id);
		const taskBranch = getWorktreeBranch(card.id);
		try {
			logger.info(`[review] Auto PR: commit → push → create for "${card.title}" (branch: ${taskBranch})`);
			await commitIfDirty(worktreePath, card.title);
			await pushBranch(worktreePath, taskBranch);
			const devSummary = [...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.content
				?? card.description;
			const prUrl = createGithubPR(worktreePath, card.title, devSummary, card.baseRef);
			logger.info(`[review] Auto PR created: ${prUrl}`);
			await updateCard(workspaceId, card.id, { githubPrUrl: prUrl });
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
): Promise<string> {
	return new Promise((resolve) => {
		let output = "";
		let unregisterProcess: (() => void) | undefined;

		const unregister = registerStopCallback(streamId, () => {
			unregisterProcess?.();
			proc.kill();
			void saveTerminalBuffer(workspaceId, streamId, output);
			if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
			resolve(output);
		});

		logger.info(`[review:${streamId}] Spawning agent "${agentId}" in ${cwd}`);
		const proc = spawnAgent({
			agentId,
			prompt,
			cwd,
			mode: "interactive",
			env: buildTaskHookEnv(streamId, workspaceId),
			// Stop hook signals completion back to runAgentOnce via registerStopCallback
			hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
			appendSystemPrompt: agentId === "claude" ? appendSystemPrompt : undefined,
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
		.split("\n").map((f) => f.trim()).filter(Boolean);
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
		sections.push("```diff\n" + diffParts.join("\n") + "\n```");
	}

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n").map((f) => f.trim()).filter(Boolean);
	if (newUntracked.length > 0) {
		const newFileContents: string[] = [];
		for (const file of newUntracked) {
			const content = readFileSafe(join(worktreePath, file));
			const ext = file.split(".").pop() ?? "";
			newFileContents.push(
				content
					? `### ${file}\n\`\`\`${ext}\n${content}\n\`\`\``
					: `### ${file} (unreadable)`,
			);
		}
		sections.push("New files (full content):\n\n" + newFileContents.join("\n\n"));
	}

	return sections.join("\n\n");
}

function formatPriorComments(card: RuntimeBoardCard): string {
	const comments = card.reviewComments ?? [];
	if (comments.length === 0) return "";
	const lines = comments.map((c) => {
		const label = c.type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
		return `### ${label} (${c.agent})\n${c.content}`;
	});
	return `\n\n---\n\n## Prior Review History\n\n${lines.join("\n\n")}`;
}

const INLINE_DIFF_LIMIT = 8000;

// Exported — used by scheduler.ts for dev agent
export function buildDevAgentSystemPrompt(slot: WorkflowSlot, card: RuntimeBoardCard, customPrompt: string): string {
	const priorContext = formatPriorComments(card);
	const parts: string[] = [];

	parts.push(`## Task: ${card.title}${card.description ? `\n\n${card.description}` : ""}${priorContext}`);

	parts.push(`You are an autonomous coding agent working on a Kanban task.

Work autonomously without asking for permission or confirmation. You have full access to the codebase in your current working directory.

When you finish your work:
1. Commit all changes with a message that describes what this specific commit changes (not just the task title): \`git add -A && git commit -m "<what changed>"\`
2. Call the \`kanban_add_comment\` MCP tool with:
   - cardId: "${card.id}"
   - type: "dev"
   - passed: true
   - content: a 2-4 sentence summary of what you implemented, key decisions, and any caveats`);

	if (customPrompt.trim()) parts.push(`## Project-specific instructions\n\n${customPrompt.trim()}`);

	return parts.join("\n\n");
}

function buildReviewSlotSystemPrompt(slot: WorkflowSlot, card: RuntimeBoardCard, stat: string, fullDiff: string, customPrompt: string): string {
	switch (slot.type) {
		case "code_review": return buildCodeReviewSystemPrompt(slot, card, stat, fullDiff, customPrompt);
		case "qa": return buildQASystemPrompt(slot, card, stat, customPrompt);
		default: return buildCustomSystemPrompt(slot, card, stat, fullDiff, customPrompt);
	}
}

function buildCodeReviewSystemPrompt(slot: WorkflowSlot, card: RuntimeBoardCard, stat: string, fullDiff: string, customPrompt: string): string {
	const priorContext = formatPriorComments(card);
	const diffSection = fullDiff.length <= INLINE_DIFF_LIMIT
		? `Git diff:\n${fullDiff}`
		: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` and read individual files to explore — start with the stat above to decide where to focus.`;
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";

	return `You are a senior code reviewer performing an automated review.

## Task to review
"${card.title}"
${card.description ? `\n${card.description}` : ""}${priorContext}

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

## How to write your finding
**If PASS:** Write 1-3 sentences. State what the implementation achieves correctly and note any non-obvious finding worth flagging. Do NOT restate things visible in the diff. Do NOT use headers or bullet points.

**If FAIL:** Be specific — file name, line number, exact problem. One bullet per issue. State what must change.

When done, call \`kanban_add_comment\` with cardId: "${card.id}", type: "code_review", passed: true/false, content starting with "PASS: ..." or "FAIL: ...".${custom}`;
}

function buildQASystemPrompt(slot: WorkflowSlot, card: RuntimeBoardCard, stat: string, customPrompt: string): string {
	const priorContext = formatPriorComments(card);
	const custom = customPrompt.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";

	return `You are a QA engineer performing automated testing.

## Task to test
"${card.title}"
${card.description ? `\n${card.description}` : ""}${priorContext}

## Changed files
${stat}

## What to do
1. Identify the app type (web, API, React Native/Expo, library, etc.)
2. Run the appropriate tests — existing test suite, TypeScript checks, Playwright, HTTP requests, etc.
3. Verify previous QA failures and human feedback have been addressed

## How to write your finding
Report only what you ran and whether it passed. Nothing else.

**If PASS:** One sentence per command run: "\`<command>\` — <result>." If no test suite exists, say so in one sentence.

**If FAIL:** Exact command, exact error output, file and line if applicable. Be reproduction-ready.

When done, call \`kanban_add_comment\` with cardId: "${card.id}", type: "qa", passed: true/false, content starting with "PASS: ..." or "FAIL: ...".${custom}`;
}

function buildCustomSystemPrompt(slot: WorkflowSlot, card: RuntimeBoardCard, stat: string, fullDiff: string, customPrompt: string): string {
	const priorContext = formatPriorComments(card);
	const diffSection = fullDiff.length <= INLINE_DIFF_LIMIT
		? `Git diff:\n${fullDiff}`
		: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` to explore.`;

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

When done, call \`kanban_add_comment\` with cardId: "${card.id}", type: "${slot.id}", passed: true/false, content starting with "PASS: ..." or "FAIL: ...".`;
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
