import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { commitIfDirty, createGithubPR, pushBranch } from "../git/merge-operations.js";
import { CLAUDE_REVIEW_MCP_CONFIG_PATH, CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, writeClaudeReviewMcpConfig } from "../agents/agent-hooks.js";
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

	// Write MCP config once per pipeline run so review agents can call kanban_add_comment
	await writeClaudeReviewMcpConfig(mcpBinary, serverUrl, workspaceId, codeReviewAgent).catch(() => {});
	// Mutate options in-place so all sub-functions receive the resolved path
	options = { ...options, mcpConfigPath: CLAUDE_REVIEW_MCP_CONFIG_PATH };
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
		const diff = getGitDiff(worktreePath, card.baseRef);

		const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
		const prompt = `Summarize the work done for task: "${card.title}"

Task description:
${card.description}${priorContext}

Git diff of changes made:
\`\`\`diff
${diff}
\`\`\`

Call \`kanban_add_comment\` with cardId: "${card.id}" and type: "dev" when done.`;

		const { codeReviewAgent, workspaceId, stateHub } = options;
		const streamId = `${card.id}-dev-summary-${Date.now()}`;
		const startTime = Date.now();
		await runAgentOnce(codeReviewAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath, DEV_SUMMARY_SYSTEM_PROMPT);

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

	const diff = getGitDiff(worktreePath, card.baseRef);
	const prompt = buildCodeReviewPrompt(card, diff);
	const systemPrompt = buildReviewSystemPrompt(CODE_REVIEW_SYSTEM_PROMPT, customPrompt);
	logger.info(`[review:${streamId}] Spawning code review agent (${codeReviewAgent}) for "${card.title}"`);
	const startTime = Date.now();
	const output = await runAgentOnce(codeReviewAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath, systemPrompt);
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

	const prompt = buildQAPrompt(card);
	const systemPrompt = buildReviewSystemPrompt(QA_SYSTEM_PROMPT, customPrompt);
	logger.info(`[review:${streamId}] Spawning QA agent (${qaAgent}) for "${card.title}"`);
	const startTime = Date.now();
	const output = await runAgentOnce(qaAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath, systemPrompt);
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

function getGitDiff(worktreePath: string, baseRef: string): string {
	const sections: string[] = [];

	// 1. Stat summary — quick map of what changed
	const statParts = [
		git(["diff", "--stat", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "--stat", "--cached"], worktreePath),
		git(["diff", "--stat"], worktreePath),
	].filter(Boolean);

	const newUntracked = git(["ls-files", "--others", "--exclude-standard"], worktreePath)
		.split("\n").map((f) => f.trim()).filter(Boolean);
	if (newUntracked.length > 0) {
		statParts.push(`New files (untracked):\n${newUntracked.map((f) => `  ${f}`).join("\n")}`);
	}

	if (statParts.length > 0) {
		sections.push("## Changed Files\n" + statParts.join("\n"));
	}

	// 2. Diff with generous context (15 lines) so changed functions are fully visible
	const diffParts = [
		git(["diff", "-U15", `${baseRef}...HEAD`], worktreePath),
		git(["diff", "-U15", "--cached"], worktreePath),
		git(["diff", "-U15"], worktreePath),
	].filter(Boolean);

	if (diffParts.length > 0) {
		sections.push("## Diff (±15 lines context)\n```diff\n" + diffParts.join("\n") + "\n```");
	}

	// 3. New untracked files — no diff exists, so include full content
	if (newUntracked.length > 0) {
		const newFileContents: string[] = [];
		for (const file of newUntracked) {
			const content = readFileSafe(join(worktreePath, file));
			const ext = file.split(".").pop() ?? "";
			newFileContents.push(
				content
					? `### ${file} (new)\n\`\`\`${ext}\n${content}\n\`\`\``
					: `### ${file} (new — unreadable)`,
			);
		}
		sections.push("## New Files (full content)\n\n" + newFileContents.join("\n\n"));
	}

	return sections.join("\n\n") || "(no changes detected — agent may not have committed yet)";
}

function formatPriorComments(card: RuntimeBoardCard, types: string[]): string {
	const comments = (card.reviewComments ?? []).filter((c) => types.includes(c.type));
	if (comments.length === 0) return "";
	const LABEL: Record<string, string> = { dev: "Dev Summary", code_review: "Code Review", qa: "QA", human: "Human Feedback" };
	const lines = comments.map((c) => `### ${LABEL[c.type] ?? c.type}\n${c.content}`);
	return `\n\n---\n\n## Prior Review History\n\n${lines.join("\n\n")}`;
}

const ALL_COMMENT_TYPES = ["dev", "code_review", "qa", "human"];

function buildReviewSystemPrompt(base: string, custom?: string): string {
	if (!custom?.trim()) return base;
	return `${base}\n\n## Project-specific instructions\n\n${custom.trim()}`;
}

const DEV_SUMMARY_SYSTEM_PROMPT = `You are summarizing work done by an AI coding agent for a pull request.

Write a concise PR-ready summary (3-6 sentences) covering:
1. What was implemented or changed
2. Key technical decisions made
3. Any notable caveats or follow-up items

Be factual and specific. Do not use bullet points — write in prose.

When done, call the \`kanban_add_comment\` MCP tool with type "dev".`;

const CODE_REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer performing an automated review.

## Review checklist
- Correctness: does the implementation do what the task requires?
- Security: any injection, auth bypass, data exposure, or unsafe operations?
- Code quality: naming, duplication, unnecessary complexity, missing error handling?
- Interface impact: for any changed function signature, type, or export — grep for callers and usages to check nothing is broken downstream
- Test coverage: are there tests? do they cover the changed behaviour?
- Previous feedback: verify all prior review failures and human feedback have been addressed

## How to work
You have full access to the codebase. Don't rely only on the diff — use your tools:
- Grep for callers of any changed function or type to check impact
- Read test files related to changed code
- Read type definitions and related modules when the change touches shared interfaces

Be specific in your findings — file names, line numbers, exact patterns.

When done, call the \`kanban_add_comment\` MCP tool with:
- type: "code_review"
- passed: true or false
- content: start with "PASS: ..." or "FAIL: ..." followed by your findings`;

const QA_SYSTEM_PROMPT = `You are a QA engineer performing automated testing.

Your testing approach:
1. Identify the app type (web, API, React Native/Expo, etc.)
2. Run appropriate tests:
   - Web/API: use Playwright or HTTP requests
   - React Native/Expo: run Jest tests and TypeScript checks
   - Any app: run the existing test suite if available
3. Verify previous QA failures and feedback have been addressed

When done, call the \`kanban_add_comment\` MCP tool with:
- type: "qa"
- passed: true or false
- content: start with "PASS: ..." or "FAIL: ..." followed by what was tested and the results`;

function buildCodeReviewPrompt(card: RuntimeBoardCard, diff: string): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	return `Review the changes for task: "${card.title}"

Task description:
${card.description}${priorContext}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Call \`kanban_add_comment\` with cardId: "${card.id}" when done.`;
}

function buildQAPrompt(card: RuntimeBoardCard): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	return `Test the implementation for task: "${card.title}"

Task description:
${card.description}${priorContext}

Call \`kanban_add_comment\` with cardId: "${card.id}" when done.`;
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
