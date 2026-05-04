import { spawnSync } from "node:child_process";
import { CLAUDE_REVIEW_MCP_CONFIG_PATH, CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, writeClaudeReviewMcpConfig } from "../agents/agent-hooks.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import type { RuntimeAgentId, RuntimeBoardCard, RuntimeReviewComment } from "../core/api-contract.js";
import type { GithubClient } from "../github/github-client.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, loadBoard, moveCard, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { getWorktreePath } from "../worktree/worktree-manager.js";

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

	console.log(`[review] Starting review pipeline for "${card.title}" (${card.id})`);
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

	const codeReviewResult = await runCodeReview(card, codeReviewStreamId, options);

	console.log(`[review] Code review ${codeReviewResult.passed ? "PASSED" : "FAILED"} for "${card.title}"`);

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
			console.log(`[review] Running QA for "${card.title}"`);
			await appendActivityLog(workspaceId, card.id, `QA running (${options.qaAgent})`);
			await appendTerminalSession(workspaceId, card.id, { streamId: qaStreamId, type: "qa", startedAt: runId });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			const qaResult = await runQA(card, qaStreamId, options);
			console.log(`[review] QA ${qaResult.passed ? "PASSED" : "FAILED"} for "${card.title}"`);
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
		const worktreePath = getWorktreePath(card.id);
		const diff = getGitDiff(worktreePath, card.baseRef);

		const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
		const prompt = `You are summarizing the work done by an AI dev agent for task: "${card.title}".

Task description:
${card.description}${priorContext}

Git diff of changes made:
\`\`\`diff
${diff}
\`\`\`

Write a concise PR-ready summary (3-6 sentences) covering:
1. What was implemented/changed
2. Key technical decisions made
3. Any notable caveats or follow-up items

Be factual and specific. Do not use bullet points — write in prose.

When done, call the \`kanban_add_comment\` MCP tool with:
- cardId: "${card.id}"
- type: "dev"
- content: your summary text`;

		const { codeReviewAgent, workspaceId, stateHub } = options;
		const streamId = `${card.id}-dev-summary-${Date.now()}`;
		const startTime = Date.now();
		await runAgentOnce(codeReviewAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath);

		const stored = await getMcpComment(workspaceId, card.id, startTime, "dev");
		return stored;
	} catch {
		return null;
	}
}

async function runCodeReview(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
): Promise<{ passed: boolean; comment: RuntimeReviewComment; storedViaMcp: boolean }> {
	const { codeReviewAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const diff = getGitDiff(worktreePath, card.baseRef);
	const prompt = buildCodeReviewPrompt(card, diff);
	const startTime = Date.now();
	const output = await runAgentOnce(codeReviewAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath);

	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, "code_review");
	if (mcpComment) {
		const passed = mcpComment.passed ?? !/(FAIL|REJECT|CRITICAL|BLOCKING)/i.test(mcpComment.content);
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	const passed = !/(FAIL|REJECT|CRITICAL|BLOCKING)/i.test(output);
	return {
		passed,
		storedViaMcp: false,
		comment: { type: "code_review", agent: codeReviewAgent, content: output.slice(0, 2000), createdAt: Date.now() },
	};
}

async function runQA(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
): Promise<{ passed: boolean; comment: RuntimeReviewComment; storedViaMcp: boolean }> {
	const { qaAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const prompt = buildQAPrompt(card);
	const startTime = Date.now();
	const output = await runAgentOnce(qaAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess, options.mcpConfigPath);

	const mcpComment = await getMcpComment(workspaceId, card.id, startTime, "qa");
	if (mcpComment) {
		const passed = mcpComment.passed ?? !/(FAIL|ERROR|CRASH|BROKEN)/i.test(mcpComment.content);
		return { passed, comment: mcpComment, storedViaMcp: true };
	}

	const passed = !/(FAIL|ERROR|CRASH|BROKEN)/i.test(output);
	return {
		passed,
		storedViaMcp: false,
		comment: { type: "qa", agent: qaAgent, content: output.slice(0, 2000), createdAt: Date.now() },
	};
}

async function persistComment(
	workspaceId: string,
	card: RuntimeBoardCard,
	comment: RuntimeReviewComment,
): Promise<void> {
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

	console.log(`[review] Review failed for "${card.title}" (attempt ${newAttempts}/${maxAutoFixAttempts}) → ${destination}`);
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
	const { workspaceId, githubClient, stateHub } = options;

	console.log(`[review] Review passed for "${card.title}" → ready for human review`);

	if (githubClient && card.githubIssueUrl) {
		try {
			await githubClient.postComment(
				card.githubIssueUrl,
				`✅ AI review passed for task "${card.title}". Ready for human review.`,
			);
		} catch {
			// non-fatal
		}
	}

	await moveCard(workspaceId, card.id, "ready_for_review");
	await appendActivityLog(workspaceId, card.id, "All reviews passed → moved to Ready for Review");
	await updateSession(workspaceId, card.id, { state: "awaiting_review", completedAt: Date.now() });
	stateHub.broadcastWorkspaceUpdate(workspaceId);
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

		const proc = spawnAgent({
			agentId,
			prompt,
			cwd,
			mode: "interactive",
			env: buildTaskHookEnv(streamId, workspaceId),
			// Stop hook signals completion back to runAgentOnce via registerStopCallback
			hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
			onOutput: (data) => {
				output += data;
				stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
			},
			onExit: () => {
				unregisterProcess?.();
				unregister();
				void saveTerminalBuffer(workspaceId, streamId, output);
				resolve(output);
			},
		});

		unregisterProcess = registerLiveProcess(streamId, proc);
	});
}

function getGitDiff(worktreePath: string, baseRef: string): string {
	// Collect committed changes since base
	const committed = spawnSync("git", ["diff", `${baseRef}...HEAD`], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	}).stdout ?? "";

	// Also collect uncommitted changes (Claude Code often doesn't auto-commit)
	const staged = spawnSync("git", ["diff", "--cached"], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	}).stdout ?? "";

	const unstaged = spawnSync("git", ["diff"], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	}).stdout ?? "";

	const combined = [committed, staged, unstaged].filter(Boolean).join("\n");
	return combined.slice(0, 8000) || "(no diff — agent may not have made changes yet)";
}

function formatPriorComments(card: RuntimeBoardCard, types: string[]): string {
	const comments = (card.reviewComments ?? []).filter((c) => types.includes(c.type));
	if (comments.length === 0) return "";
	const LABEL: Record<string, string> = { dev: "Dev Summary", code_review: "Code Review", qa: "QA" };
	const lines = comments.map((c) => `### ${LABEL[c.type] ?? c.type}\n${c.content}`);
	return `\n\n---\n\n${lines.join("\n\n")}`;
}

const ALL_COMMENT_TYPES = ["dev", "code_review", "qa", "human"];

function buildCodeReviewPrompt(card: RuntimeBoardCard, diff: string): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	return `You are a senior code reviewer. Review the following changes for task "${card.title}".

Task description:
${card.description}${priorContext}

if there is new PlayerInputType make sure to check if it's properly handled in the input parser and the UI.

Git diff:
\`\`\`diff
${diff}
\`\`\`

Review for correctness, security, code quality, and whether the implementation matches the requirements.
Pay attention to any previous review failures and human feedback above — verify they have been addressed.
Be specific — call out exact file names, line numbers, or patterns that need fixing.

When done, call the \`kanban_add_comment\` MCP tool with:
- cardId: "${card.id}"
- type: "code_review"
- passed: true or false
- content: start with "PASS: ..." or "FAIL: ..." followed by your detailed findings`;
}

function buildQAPrompt(card: RuntimeBoardCard): string {
	const priorContext = formatPriorComments(card, ALL_COMMENT_TYPES);
	return `You are a QA engineer. Test the implementation for task "${card.title}".

Task description:
${card.description}${priorContext}

Look at the codebase and:
1. Identify the app type (web, API, React Native/Expo, etc.)
2. Run appropriate tests:
   - Web/API: use Playwright or HTTP requests
   - React Native/Expo: run Jest tests and TypeScript checks
   - Any app: run the existing test suite if available

Pay attention to any previous QA failures and feedback above — verify those specific issues are fixed.

When done, call the \`kanban_add_comment\` MCP tool with:
- cardId: "${card.id}"
- type: "qa"
- passed: true or false
- content: start with "PASS: ..." or "FAIL: ..." followed by what was tested and the results`;
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
	} catch {
		return null;
	}
}
