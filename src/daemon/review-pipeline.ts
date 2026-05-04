import { spawnSync } from "node:child_process";
import { CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv } from "../agents/agent-hooks.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import type { RuntimeAgentId, RuntimeBoardCard, RuntimeReviewComment } from "../core/api-contract.js";
import type { GithubClient } from "../github/github-client.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, moveCard, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { getWorktreePath } from "../worktree/worktree-manager.js";

interface ReviewPipelineOptions {
	workspaceId: string;
	repoPath: string;
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
	const { workspaceId, stateHub } = options;
	const runId = Date.now();
	const codeReviewStreamId = `${card.id}-cr-${runId}`;
	const qaStreamId = `${card.id}-qa-${runId}`;

	console.log(`[review] Starting review pipeline for "${card.title}" (${card.id})`);
	await updateSession(workspaceId, card.id, { state: "review_in_progress" });
	await appendActivityLog(workspaceId, card.id, "AI review started");
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	// Step 1: Code review — runs immediately (stateless, no resource conflicts)
	console.log(`[review] Running code review for "${card.title}"`);
	await appendActivityLog(workspaceId, card.id, `Code review running (${options.codeReviewAgent})`);
	await appendTerminalSession(workspaceId, card.id, { streamId: codeReviewStreamId, type: "code-review", startedAt: runId });
	stateHub.broadcastWorkspaceUpdate(workspaceId);
	const codeReviewResult = await runCodeReview(card, codeReviewStreamId, options);
	console.log(`[review] Code review ${codeReviewResult.passed ? "PASSED" : "FAILED"} for "${card.title}"`);

	if (!codeReviewResult.passed) {
		await appendActivityLog(workspaceId, card.id, "Code review: FAIL");
		await handleReviewFailure(card, codeReviewResult.comment, options);
		return;
	}

	await appendActivityLog(workspaceId, card.id, "Code review: PASS");
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
				await handleReviewFailure(card, qaResult.comment, options);
			} else {
				await appendActivityLog(workspaceId, card.id, "QA: PASS");
				await handleReviewSuccess(card, options);
			}
			resolve();
		});
	});
}

async function runCodeReview(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
): Promise<{ passed: boolean; comment: RuntimeReviewComment }> {
	const { codeReviewAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const diff = getGitDiff(worktreePath, card.baseRef);
	const prompt = buildCodeReviewPrompt(card, diff);
	const output = await runAgentOnce(
		codeReviewAgent,
		prompt,
		worktreePath,
		workspaceId,
		streamId,
		stateHub,
		options.registerStopCallback,
		options.registerLiveProcess,
	);

	const passed = !/(FAIL|REJECT|CRITICAL|BLOCKING)/i.test(output) || /(PASS|APPROVED|LGTM)/i.test(output);

	return {
		passed,
		comment: {
			type: "code_review",
			agent: codeReviewAgent,
			content: output.slice(0, 2000),
			createdAt: Date.now(),
		},
	};
}

async function runQA(
	card: RuntimeBoardCard,
	streamId: string,
	options: ReviewPipelineOptions,
): Promise<{ passed: boolean; comment: RuntimeReviewComment }> {
	const { qaAgent, workspaceId, stateHub } = options;
	const worktreePath = getWorktreePath(card.id);

	const prompt = buildQAPrompt(card);
	const output = await runAgentOnce(qaAgent, prompt, worktreePath, workspaceId, streamId, stateHub, options.registerStopCallback, options.registerLiveProcess);

	const passed = !/(FAIL|ERROR|CRASH|BROKEN)/i.test(output) || /(PASS|OK|SUCCESS)/i.test(output);

	return {
		passed,
		comment: {
			type: "qa",
			agent: qaAgent,
			content: output.slice(0, 2000),
			createdAt: Date.now(),
		},
	};
}

async function handleReviewFailure(
	card: RuntimeBoardCard,
	comment: RuntimeReviewComment,
	options: ReviewPipelineOptions,
): Promise<void> {
	const { workspaceId, maxAutoFixAttempts, stateHub } = options;
	const newAttempts = card.autoFixAttempts + 1;
	const updatedComments = [...(card.reviewComments ?? []), comment];
	const destination = newAttempts >= maxAutoFixAttempts ? "blocked" : "reopened";

	console.log(`[review] Review failed for "${card.title}" (attempt ${newAttempts}/${maxAutoFixAttempts}) → ${destination}`);
	await updateCard(workspaceId, card.id, { autoFixAttempts: newAttempts, reviewComments: updatedComments });
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
			hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
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

function buildCodeReviewPrompt(card: RuntimeBoardCard, diff: string): string {
	return `You are a senior code reviewer. Review the following changes for task "${card.title}".

Task description:
${card.description}

Git diff:
\`\`\`diff
${diff}
\`\`\`

Review for correctness, security, code quality, and whether the implementation matches requirements.

Respond with either:
- "PASS: <brief explanation>" if the code is acceptable
- "FAIL: <specific issues to fix>" if there are blocking problems`;
}

function buildQAPrompt(card: RuntimeBoardCard): string {
	return `You are a QA engineer. Test the implementation for task "${card.title}".

Task description:
${card.description}

Look at the codebase and:
1. Identify the app type (web, API, React Native/Expo, etc.)
2. Run appropriate tests:
   - Web/API: use Playwright or HTTP requests
   - React Native/Expo: run Jest tests and TypeScript checks
   - Any app: run the existing test suite if available

Respond with either:
- "PASS: <what was tested>" if everything works
- "FAIL: <specific failures>" if there are issues`;
}
