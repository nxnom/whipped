import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commitIfDirty, createGithubPR, pushBranch } from "../git/merge-operations.js";
import { CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, getMcpConfigPath, writeClaudeMcpConfig } from "../agents/agent-hooks.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import type { RuntimeAgentId, RuntimeBoardCard, RuntimeReviewComment } from "../core/api-contract.js";
import type { GithubClient } from "../github/github-client.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, loadBoard, moveCard, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { getWorktreeBranch, getWorktreePath } from "../worktree/worktree-manager.js";
import { logger } from "../core/logger.js";

interface ReviewPipelineOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	mcpBinary: { command: string; args: string[] };
	mcpConfigPath?: string; // resolved after writeClaudeReviewMcpConfig
	codeReviewAgent: RuntimeAgentId;
	qaAgent: RuntimeAgentId;
	maxAutoFixAttempts: number;
	stateHub: RuntimeStateHub;
	githubClient?: GithubClient;
	codeReviewPrompt?: string;
	qaPrompt?: string;
	autoPR: boolean;
	registerStopCallback: (streamId: string, callback: () => void) => (() => void);
	registerLiveProcess: (streamId: string, process: AgentProcess) => (() => void);
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
	const { workspaceId, stateHub, serverUrl, mcpBinary, codeReviewAgent } = options;
	const runId = Date.now();

	const codeReviewStreamId = `${card.id}-cr-${runId}`;
	const qaStreamId = `${card.id}-qa-${runId}`;

	logger.info(`[review] Starting review pipeline for "${card.title}" (${card.id})`);
	await updateSession(workspaceId, card.id, { state: "review_in_progress" });
	await appendActivityLog(workspaceId, card.id, "AI review started");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// Reload card so we have the latest reviewComments including any dev summary the agent may
	// have stored via MCP just before the Stop hook fired.
	const freshBoard = await loadBoard(workspaceId);
	card = freshBoard.cards[card.id] ?? card;

	// Check if the dev agent wrote a summary during THIS run by comparing against the start
	// time of the most recent dev terminal session. Falls back to 0 (first run / no session).
	const devSessions = (card.terminalSessions ?? []).filter((s) => s.type === "dev");
	const lastDevStartedAt = devSessions.at(-1)?.startedAt ?? 0;
	const hasDevSummary = (card.reviewComments ?? []).some(
		(c) => c.type === "dev" && c.createdAt >= lastDevStartedAt,
	);

	// If the dev agent didn't call kanban_add_comment, generate a summary as fallback.
	if (!hasDevSummary) {
		const fallback = await generateDevSummary(card, options);
		if (fallback) card = { ...card, reviewComments: [...(card.reviewComments ?? []), fallback] };
	}

	await appendActivityLog(workspaceId, card.id, `Code review running (${options.codeReviewAgent})`);
	await appendTerminalSession(workspaceId, card.id, { streamId: codeReviewStreamId, type: "code-review", startedAt: runId });
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	const codeReviewResult = await runCodeReview(card, codeReviewStreamId, options, options.codeReviewPrompt);

	logger.info(`[review] Code review ${codeReviewResult.passed ? "PASSED" : "FAILED"} for "${card.title}"`);

	if (!codeReviewResult.passed) {
		await appendActivityLog(workspaceId, card.id, "Code review: FAIL");
		if (!codeReviewResult.storedViaMcp) await persistComment(workspaceId, card, codeReviewResult.comment);
		await handleReviewFailure(card, options);
		return;
	}

	await appendActivityLog(workspaceId, card.id, "Code review: PASS");
	if (!codeReviewResult.storedViaMcp) await persistComment(workspaceId, card, codeReviewResult.comment);
	card = { ...card, reviewComments: [...(card.reviewComments ?? []), codeReviewResult.comment] };
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// Step 2: QA — serialised to avoid port/simulator conflicts
	await new Promise<void>((resolve) => {
		enqueueQA(async () => {
			logger.info(`[review] Running QA for "${card.title}"`);
			await appendActivityLog(workspaceId, card.id, `QA running (${options.qaAgent})`);
			await appendTerminalSession(workspaceId, card.id, { streamId: qaStreamId, type: "qa", startedAt: runId });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			const qaResult = await runQA(card, qaStreamId, options, options.qaPrompt);
			logger.info(`[review] QA ${qaResult.passed ? "PASSED" : "FAILED"} for "${card.title}"`);
			if (!qaResult.passed) {
				await appendActivityLog(workspaceId, card.id, "QA: FAIL");
				if (!qaResult.storedViaMcp) await persistComment(workspaceId, card, qaResult.comment);
				await handleReviewFailure(card, options);
			} else {
				await appendActivityLog(workspaceId, card.id, "QA: PASS");
				if (!qaResult.storedViaMcp) await persistComment(workspaceId, card, qaResult.comment);
				await handleReviewSuccess(card, options);
			}
			resolve();
		});
	});
}

async function generateDevSummary(
	card: RuntimeBoardCard,
	options: ReviewPipelineOptions,
): Promise<RuntimeReviewComment | null> {
	try {
		logger.info(`[review:${card.id}] Generating dev summary for "${card.title}"`);
		const worktreePath = getWorktreePath(card.id);
		const stat = getGitStat(worktreePath, card.baseRef);
		const fullDiff = getGitFullDiff(worktreePath, card.baseRef);

		const { codeReviewAgent, workspaceId, stateHub } = options;
		const streamId = `${card.id}-dev-summary-${Date.now()}`;
		const mcpConfigPath = getMcpConfigPath(streamId);
		await writeClaudeMcpConfig(options.mcpBinary, options.serverUrl, workspaceId, codeReviewAgent, mcpConfigPath).catch(() => {});
		const startTime = Date.now();
		await runAgentOnce(codeReviewAgent, "Start.", worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, mcpConfigPath, buildDevSummarySystemPrompt(card, stat, fullDiff));

		const stored = await getMcpComment(workspaceId, card.id, startTime, "dev");
		logger.info(`[review:${card.id}] Dev summary ${stored ? "generated via MCP" : "not generated (agent did not call MCP)"}`);
		return stored;
	} catch (err) {
		logger.error({ err }, `[review:${card.id}] Dev summary generation failed:`);
		return null;
	}
}

async function runCodeReview(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
	customPrompt?: string,
): Promise<{ passed: boolean; comment: RuntimeReviewComment; storedViaMcp: boolean }> {
	const { codeReviewAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const stat = getGitStat(worktreePath, card.baseRef);
	const fullDiff = getGitFullDiff(worktreePath, card.baseRef);
	const systemPrompt = buildCodeReviewSystemPrompt(card, stat, fullDiff, customPrompt);
	logger.info(`[review:${streamId}] Spawning code review agent (${codeReviewAgent}) for "${card.title}"`);
	const mcpConfigPath = getMcpConfigPath(streamId);
	await writeClaudeMcpConfig(options.mcpBinary, options.serverUrl, workspaceId, codeReviewAgent, mcpConfigPath).catch(() => {});
	const startTime = Date.now();
	const output = await runAgentOnce(codeReviewAgent, "Start Code Review.", worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, mcpConfigPath, systemPrompt);
	logger.info(`[review:${streamId}] Code review agent done (${Date.now() - startTime}ms)`);

	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, "code_review");
	if (mcpComment) {
		const passed = mcpComment.passed ?? !/(FAIL|REJECT|CRITICAL|BLOCKING)/i.test(mcpComment.content);
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	const passed = !/(FAIL|REJECT|CRITICAL|BLOCKING)/i.test(output);
	return {
		passed,
		storedViaMcp: false,
		comment: { type: "code_review", agent: codeReviewAgent, content: output, createdAt: Date.now() },
	};
}

async function runQA(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
	customPrompt?: string,
): Promise<{ passed: boolean; comment: RuntimeReviewComment; storedViaMcp: boolean }> {
	const { qaAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const stat = getGitStat(worktreePath, card.baseRef);
	const systemPrompt = buildQASystemPrompt(card, stat, customPrompt);
	logger.info(`[review:${streamId}] Spawning QA agent (${qaAgent}) for "${card.title}"`);
	const mcpConfigPath = getMcpConfigPath(streamId);
	await writeClaudeMcpConfig(options.mcpBinary, options.serverUrl, workspaceId, qaAgent, mcpConfigPath).catch(() => {});
	const startTime = Date.now();
	const output = await runAgentOnce(qaAgent, "Start QA.", worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, mcpConfigPath, systemPrompt);
	logger.info(`[review:${streamId}] QA agent done (${Date.now() - startTime}ms)`);

	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, "qa");
	if (mcpComment) {
		const passed = mcpComment.passed ?? !/(FAIL|ERROR|CRASH|BROKEN)/i.test(mcpComment.content);
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	const passed = !/(FAIL|ERROR|CRASH|BROKEN)/i.test(output);
	return {
		passed,
		storedViaMcp: false,
		comment: { type: "qa", agent: qaAgent, content: output, createdAt: Date.now() },
	};
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
			commitIfDirty(worktreePath, card.title);
			pushBranch(worktreePath, taskBranch);
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
	agentId: RuntimeAgentId,
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

function formatPriorComments(card: RuntimeBoardCard, types: string[]): string {
	const comments = (card.reviewComments ?? []).filter((c) => types.includes(c.type));
	if (comments.length === 0) return "";
	const LABEL: Record<string, string> = { dev: "Dev Summary", code_review: "Code Review", qa: "QA", human: "Human Feedback" };
	const lines = comments.map((c) => `### ${LABEL[c.type] ?? c.type}\n${c.content}`);
	return `\n\n---\n\n## Prior Review History\n\n${lines.join("\n\n")}`;
}

const ALL_COMMENT_TYPES = ["dev", "code_review", "qa", "human"];
const INLINE_DIFF_LIMIT = 8000;

function buildDevSummarySystemPrompt(card: RuntimeBoardCard, stat: string, fullDiff: string): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	const diffSection = fullDiff.length <= INLINE_DIFF_LIMIT
		? `Git diff:\n${fullDiff}`
		: `Large changeset. Changed files:\n${stat}\n\nUse \`git diff ${card.baseRef}...HEAD\` to read the full diff.`;

	return `You are summarizing work done by an AI coding agent for a pull request.

## Task
"${card.title}"
${card.description ? `\n${card.description}` : ""}${priorContext}

## Changes
${stat}

${diffSection}

## Instructions
Write a concise PR-ready summary in 2-4 sentences covering:
1. What was changed and why
2. Any non-obvious technical decisions (skip anything self-evident from the diff)
3. Caveats or follow-up items only if they exist

Be specific. No headers, no bullet points, no prose that just restates the diff.

When done, call the \`kanban_add_comment\` MCP tool with cardId: "${card.id}" and type: "dev".`;
}

function buildCodeReviewSystemPrompt(card: RuntimeBoardCard, stat: string, fullDiff: string, customPrompt?: string): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	const diffSection = fullDiff.length <= INLINE_DIFF_LIMIT
		? `Git diff:\n${fullDiff}`
		: `Large changeset (${fullDiff.length.toLocaleString()} chars). Use \`git diff ${card.baseRef}...HEAD\` and read individual files to explore — start with the stat above to decide where to focus.`;

	const custom = customPrompt?.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";

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
**If PASS:** Write 1-3 sentences. State what the implementation achieves correctly and note any non-obvious finding worth flagging. Do NOT restate things visible in the diff (field names, export chains, type signatures). Do NOT use headers or bullet points.

**If FAIL:** Be specific — file name, line number, exact problem. One bullet per issue. State what must change.

When done, call \`kanban_add_comment\` with cardId: "${card.id}", type: "code_review", passed: true/false, content starting with "PASS: ..." or "FAIL: ...".${custom}`;
}

function buildQASystemPrompt(card: RuntimeBoardCard, stat: string, customPrompt?: string): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	const custom = customPrompt?.trim() ? `\n\n## Project-specific instructions\n\n${customPrompt.trim()}` : "";

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

**If PASS:** One sentence per command run: "\`<command>\` — <result>." If no test suite exists, say so in one sentence. Do NOT describe the code, re-explain the implementation, restate exports, or summarize what the code reviewer already said.

**If FAIL:** Exact command, exact error output, file and line if applicable. Be reproduction-ready.

When done, call \`kanban_add_comment\` with cardId: "${card.id}", type: "qa", passed: true/false, content starting with "PASS: ..." or "FAIL: ...".${custom}`;
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
