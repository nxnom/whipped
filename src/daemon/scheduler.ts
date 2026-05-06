import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { commitIfDirty } from "../git/merge-operations.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import { getAvailableAgents } from "../agents/agent-registry.js";
import { CLAUDE_HOME_MCP_CONFIG_PATH, CLAUDE_REVIEW_MCP_CONFIG_PATH, CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, writeClaudeHomeSettings, writeClaudeReviewMcpConfig } from "../agents/agent-hooks.js";
import type { RuntimeAgentId, RuntimeBoardCard } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, loadBoard, loadProjectConfig, moveCard, removeSession, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { createWorktree, getWorktreeBranch, getWorktreePath, removeWorktree } from "../worktree/worktree-manager.js";

export interface SchedulerOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	maxParallelTasks: number;
	maxAutoFixAttempts: number;
	defaultAgent: RuntimeAgentId;
	stateHub: RuntimeStateHub;
	onTaskCompleted: (taskId: string) => void;
}

interface RunningTask {
	taskId: string;
	streamId: string; // unique per run: "${taskId}-dev-${startedAt}"
	agentId: RuntimeAgentId;
	process: AgentProcess;
	startedAt: number;
	outputBuffer: string;
}

const FAST_EXIT_THRESHOLD_MS = 8_000;

const HOME_AGENT_PREFIX = "__home__:";

export class TaskScheduler {
	private running = new Map<string, RunningTask>();
	private homeSessions = new Map<string, RunningTask>();
	// Keep the last output buffer around after a task exits so the terminal
	// can still restore when the user opens it for a completed/awaiting-review task.
	private recentBuffers = new Map<string, string>();
	// One-shot Stop hook callbacks for review agents (not tracked as board cards).
	private stopCallbacks = new Map<string, () => void>();
	// Live process registry for review agents (resize/write support).
	private liveProcesses = new Map<string, AgentProcess>();
	// Tasks whose completion is being handled by the Stop hook.
	// Checked synchronously in onExit to avoid the race between kill() and moveCard().
	private hookHandledTasks = new Set<string>();

	constructor(private options: SchedulerOptions) {}

	// Register a callback that fires once when the Stop hook fires for streamId.
	// Returns an unregister function for cleanup.
	registerStopCallback(streamId: string, callback: () => void): () => void {
		this.stopCallbacks.set(streamId, callback);
		return () => this.stopCallbacks.delete(streamId);
	}

	// Register a live agent process for resize/write — used by review agents.
	registerLiveProcess(streamId: string, process: AgentProcess): () => void {
		this.liveProcesses.set(streamId, process);
		return () => this.liveProcesses.delete(streamId);
	}

	get homeAgentTaskId(): string {
		return `${HOME_AGENT_PREFIX}${this.options.workspaceId}`;
	}

	async startHomeAgent(): Promise<string> {
		const { workspaceId, repoPath, serverUrl, stateHub, defaultAgent } = this.options;
		const taskId = this.homeAgentTaskId;
		const agentId = defaultAgent;

		// Stop any existing session first
		const existing = this.homeSessions.get(taskId);
		if (existing) {
			existing.process.kill();
			this.homeSessions.delete(taskId);
		}

		const prompt = buildHomeAgentInitialMessage();
		const appendSystemPrompt = buildHomeAgentSystemPrompt(repoPath);
		await writeClaudeHomeSettings(getMcpServerPath(), serverUrl, workspaceId).catch((err) => {
			logger.warn("[scheduler] Failed to write home agent MCP settings:", err);
		});

		const homeTask: RunningTask = {
			taskId,
			streamId: taskId, // home agent uses taskId as its stream (single session)
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: repoPath,
				mcpConfigPath: agentId === "claude" ? CLAUDE_HOME_MCP_CONFIG_PATH : undefined,
				appendSystemPrompt: agentId === "claude" ? appendSystemPrompt : undefined,
				onOutput: (data) => {
					homeTask.outputBuffer += data;
					stateHub.broadcastTerminalOutput(workspaceId, taskId, data);
				},
				onExit: () => {
					this.recentBuffers.set(taskId, homeTask.outputBuffer);
					this.homeSessions.delete(taskId);
				},
			}),
			startedAt: Date.now(),
			outputBuffer: "",
		};

		this.homeSessions.set(taskId, homeTask);
		return taskId;
	}

	stopHomeAgent(): void {
		const taskId = this.homeAgentTaskId;
		const home = this.homeSessions.get(taskId);
		if (home) {
			home.process.kill();
			this.homeSessions.delete(taskId);
		}
	}

	isHomeAgentRunning(): boolean {
		return this.homeSessions.has(this.homeAgentTaskId);
	}

	get activeCount(): number {
		return this.running.size;
	}

	get maxParallelTasks(): number {
		return this.options.maxParallelTasks;
	}

	canAcceptTask(inFlightCount?: number): boolean {
		const count = inFlightCount ?? this.running.size;
		return count < this.options.maxParallelTasks;
	}

	async startTask(card: RuntimeBoardCard): Promise<void> {
		const { workspaceId, repoPath, stateHub } = this.options;
		const agentId = card.agentId ?? this.options.defaultAgent;
		const taskId = card.id;

		// Guard: check agent binary is available before spawning
		const available = getAvailableAgents().map((a) => a.id);
		if (!available.includes(agentId)) {
			logger.error(`[scheduler] Agent "${agentId}" not found in PATH — blocking task "${card.title}"`);
			await moveCard(workspaceId, taskId, "blocked");
			await appendActivityLog(workspaceId, taskId, `Agent "${agentId}" not found in PATH — moved to Blocked`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}

		logger.info(`[scheduler] Starting task ${taskId} "${card.title}" with agent ${agentId}`);

		// Check and resolve dependencies
		let effectiveBaseRef = card.baseRef;
		if (card.dependsOn && card.dependsOn.length > 0) {
			const board = await loadBoard(workspaceId);
			const unmetDep = card.dependsOn.find((depId) => {
				const dep = board.cards[depId];
				return !dep || (dep.columnId !== "ready_for_review" && dep.columnId !== "done");
			});
			if (unmetDep) {
				await moveCard(workspaceId, taskId, "blocked");
				const depCard = board.cards[unmetDep];
				await appendActivityLog(workspaceId, taskId, `Blocked: dependency "${depCard?.title ?? unmetDep}" is not yet complete`);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				return;
			}
			// Branch from the last dep that is still in ready_for_review (unmerged)
			for (let i = card.dependsOn.length - 1; i >= 0; i--) {
				const depId = card.dependsOn[i] as string;
				const dep = board.cards[depId];
				if (dep?.columnId === "ready_for_review") {
					effectiveBaseRef = getWorktreeBranch(depId);
					break;
				}
			}
		}

		// Write MCP config so the dev agent can call kanban_add_comment when done
		await writeClaudeReviewMcpConfig(getMcpServerPath(), this.options.serverUrl, workspaceId, agentId).catch(() => {});

		// Create isolated worktree
		const worktree = createWorktree(taskId, repoPath, effectiveBaseRef);

		// Reload project config so latest prompts + setup config are used
		const projectConfig = await loadProjectConfig(workspaceId);

		// Move card + update session immediately so the UI reflects it before setup runs
		const taskStartedAt = Date.now();
		await updateSession(workspaceId, taskId, {
			taskId,
			state: "running",
			agentId,
			worktreePath: worktree.path,
			startedAt: taskStartedAt,
		});
		await moveCard(workspaceId, taskId, "in_progress");
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		// On first creation, copy files and run install command — each step is logged
		if (worktree.isNew && projectConfig.worktreeSetup) {
			const { filesToCopy, installCommand } = projectConfig.worktreeSetup;

			if (filesToCopy.length > 0) {
				const copied: string[] = [];
				for (const relPath of filesToCopy) {
					const src = join(repoPath, relPath);
					if (!existsSync(src)) continue;
					const dst = join(worktree.path, relPath);
					mkdirSync(dirname(dst), { recursive: true });
					try { copyFileSync(src, dst); copied.push(relPath); } catch { /* best-effort */ }
				}
				if (copied.length > 0) {
					await appendActivityLog(workspaceId, taskId, `Copied to worktree: ${copied.join(", ")}`);
					stateHub.broadcastWorkspaceUpdate(workspaceId);
				}
			}

			if (installCommand.trim()) {
				await appendActivityLog(workspaceId, taskId, `Running: ${installCommand.trim()}`);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				await new Promise<void>((resolve) => {
					const proc = spawn("sh", ["-c", installCommand.trim()], {
						cwd: worktree.path,
						stdio: "ignore",
						env: { ...process.env, REPO_PATH: repoPath },
					});
					proc.on("close", () => resolve());
				});
				await appendActivityLog(workspaceId, taskId, "Install complete");
				stateHub.broadcastWorkspaceUpdate(workspaceId);
			}
		}

		const prompt = buildTaskPrompt(card);
		const taskSystemPrompt = buildTaskAgentSystemPrompt(card, projectConfig.devPrompt);

		await appendActivityLog(workspaceId, taskId, `Agent ${agentId} started`);

		const spawnedAt = Date.now();
		const devStreamId = `${taskId}-dev-${spawnedAt}`;

		await appendTerminalSession(workspaceId, taskId, { streamId: devStreamId, type: "dev", startedAt: spawnedAt });
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		const runningTask: RunningTask = {
			taskId,
			streamId: devStreamId,
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: worktree.path,
				env: buildTaskHookEnv(taskId, workspaceId),
				hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
				mcpConfigPath: agentId === "claude" ? CLAUDE_REVIEW_MCP_CONFIG_PATH : undefined,
				appendSystemPrompt: agentId === "claude" ? taskSystemPrompt : undefined,
				onOutput: (data) => {
					runningTask.outputBuffer += data;
					stateHub.broadcastTerminalOutput(workspaceId, devStreamId, data);
				},
				onExit: async (exitCode) => {
					this.recentBuffers.set(devStreamId, runningTask.outputBuffer);
					void saveTerminalBuffer(workspaceId, devStreamId, runningTask.outputBuffer);
					this.running.delete(taskId);

					// Synchronous check — must happen before any await.
					// The Stop hook sets this flag before calling kill() so that when
					// onExit fires (synchronously during kill), we skip the duplicate
					// onTaskCompleted call and card transition entirely.
					if (this.hookHandledTasks.has(taskId)) {
						this.hookHandledTasks.delete(taskId);
						await updateSession(workspaceId, taskId, {
							state: "awaiting_review",
							exitCode,
							completedAt: Date.now(),
							lastOutput: runningTask.outputBuffer.slice(-4096),
						});
						stateHub.broadcastWorkspaceUpdate(workspaceId);
						return;
					}

					const elapsed = Date.now() - spawnedAt;
					const isFastExit = elapsed < FAST_EXIT_THRESHOLD_MS;

					logger.info(`[scheduler] Task ${taskId} exited with code ${exitCode} after ${Math.round(elapsed / 1000)}s`);

					await updateSession(workspaceId, taskId, {
						state: exitCode === 0 ? "awaiting_review" : "failed",
						exitCode,
						completedAt: Date.now(),
						lastOutput: runningTask.outputBuffer.slice(-4096),
					});

					if (exitCode === 0) {
						await moveCard(workspaceId, taskId, "in_review");
						await appendActivityLog(workspaceId, taskId, "Agent finished → moved to In Review");
					} else {
						const board = await loadBoard(workspaceId);
						const latestCard = board.cards[taskId] ?? card;
						const newAttempts = latestCard.autoFixAttempts + 1;
						await updateCard(workspaceId, taskId, { autoFixAttempts: newAttempts });
						const destination = newAttempts >= this.options.maxAutoFixAttempts ? "blocked" : "reopened";

						if (isFastExit) {
							logger.error(`[scheduler] Task ${taskId} failed within ${Math.round(elapsed / 1000)}s — possible launch error`);
							await appendActivityLog(
								workspaceId,
								taskId,
								`Agent failed to launch (code ${exitCode}, ${Math.round(elapsed / 1000)}s) → ${destination === "blocked" ? "Blocked" : "Reopened"} (attempt ${newAttempts}/${this.options.maxAutoFixAttempts})`,
							);
						} else {
							await appendActivityLog(
								workspaceId,
								taskId,
								`Agent exited with error (code ${exitCode}) → ${destination === "blocked" ? "Blocked" : "Reopened"} (attempt ${newAttempts}/${this.options.maxAutoFixAttempts})`,
							);
						}

						await moveCard(workspaceId, taskId, destination);
					}
					stateHub.broadcastWorkspaceUpdate(workspaceId);
					this.options.onTaskCompleted(taskId);
				},
			}),
			startedAt: spawnedAt,
			outputBuffer: "",
		};

		this.running.set(taskId, runningTask);
	}

	stopTask(taskId: string): void {
		const task = this.running.get(taskId);
		if (task) {
			logger.info(`[scheduler] Stopping task ${taskId}`);
			task.process.kill();
			this.running.delete(taskId);
			void appendActivityLog(this.options.workspaceId, taskId, "Agent stopped manually");
		}
	}

	getOutputBuffer(streamId: string): string {
		// Active dev tasks: look up by streamId (unique per run)
		for (const task of this.running.values()) {
			if (task.streamId === streamId) return task.outputBuffer;
		}
		// Home agent sessions use taskId as their streamId
		const homeSession = this.homeSessions.get(streamId);
		if (homeSession) return homeSession.outputBuffer;
		// Completed tasks / recent buffers
		return this.recentBuffers.get(streamId) ?? "";
	}

	resizeTerminal(streamId: string, cols: number, rows: number): void {
		const proc = this.findProcess(streamId);
		proc?.resize(cols, rows);
	}

	writeToTerminal(streamId: string, data: string): void {
		const proc = this.findProcess(streamId);
		proc?.write(data);
	}

	private findProcess(streamId: string): AgentProcess | undefined {
		// running is keyed by card ID but dev terminals connect by streamId — search both ways
		const byCardId = this.running.get(streamId)?.process;
		if (byCardId) return byCardId;
		for (const task of this.running.values()) {
			if (task.streamId === streamId) return task.process;
		}
		return this.homeSessions.get(streamId)?.process ?? this.liveProcesses.get(streamId);
	}

	async handleHookEvent(event: "stop" | "user_prompt", taskId: string): Promise<void> {
		const { workspaceId, stateHub } = this.options;

		// Fire one-shot callbacks registered by the review pipeline first.
		if (event === "stop" && this.stopCallbacks.has(taskId)) {
			const cb = this.stopCallbacks.get(taskId)!;
			this.stopCallbacks.delete(taskId);
			cb();
			return;
		}

		if (event === "stop") {
			const board = await loadBoard(workspaceId);
			const card = board.cards[taskId];
			if (!card || card.columnId !== "in_progress") return;

			// Mark before killing — onExit checks this synchronously to skip the
			// duplicate onTaskCompleted call (kill fires onExit before moveCard runs).
			this.hookHandledTasks.add(taskId);
			const task = this.running.get(taskId);
			if (task) {
				this.recentBuffers.set(task.streamId, task.outputBuffer);
				void saveTerminalBuffer(workspaceId, task.streamId, task.outputBuffer);
				task.process.kill();
				this.running.delete(taskId);
			}

			if (card.githubPrUrl) {
				const worktreePath = getWorktreePath(taskId);
				const taskBranch = getWorktreeBranch(taskId);
				commitIfDirty(worktreePath, card.title);
				const pushResult = spawnSync("git", ["push", "origin", taskBranch], { cwd: worktreePath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
				if (pushResult.status === 0) {
					await appendActivityLog(workspaceId, taskId, `Pushed to PR`);
				} else {
					await appendActivityLog(workspaceId, taskId, `Push failed: ${pushResult.stderr?.trim()}`);
				}
			}
			await moveCard(workspaceId, taskId, "in_review");
			await appendActivityLog(workspaceId, taskId, "Agent finished → moved to In Review");
			await updateSession(workspaceId, taskId, { state: "awaiting_review" });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			logger.info(`[scheduler] Hook Stop: task ${taskId} → in_review`);
			this.options.onTaskCompleted(taskId);
		} else if (event === "user_prompt") {
			const board = await loadBoard(workspaceId);
			const card = board.cards[taskId];
			if (!card || card.columnId !== "in_review") return;

			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "User continued → moved back to In Progress");
			await updateSession(workspaceId, taskId, { state: "running" });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			logger.info(`[scheduler] Hook UserPromptSubmit: task ${taskId} → in_progress`);
		}
	}

	async startConflictResolution(
		card: RuntimeBoardCard,
		mergeWorktreePath: string,
		conflictedFiles: string[],
		onComplete: (success: boolean) => Promise<void>,
	): Promise<void> {
		const { workspaceId, stateHub, defaultAgent } = this.options;
		const streamId = `${card.id}-conflict-${Date.now()}`;

		await appendTerminalSession(workspaceId, card.id, { streamId, type: "conflict", startedAt: Date.now() });
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		let outputBuffer = "";
		let hookHandled = false;

		const proc = spawnAgent({
			agentId: defaultAgent,
			prompt: buildConflictResolutionPrompt(card, conflictedFiles),
			cwd: mergeWorktreePath,
			hookSettingsPath: defaultAgent === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			env: buildTaskHookEnv(streamId, workspaceId),
			appendSystemPrompt: CONFLICT_RESOLUTION_SYSTEM_PROMPT,
			onOutput: (data) => {
				outputBuffer += data;
				stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
			},
			onExit: async (exitCode) => {
				this.liveProcesses.delete(streamId);
				this.recentBuffers.set(streamId, outputBuffer);
				void saveTerminalBuffer(workspaceId, streamId, outputBuffer);
				if (!hookHandled) await onComplete(exitCode === 0);
			},
		});

		this.liveProcesses.set(streamId, proc);

		this.registerStopCallback(streamId, () => {
			hookHandled = true;
			this.liveProcesses.delete(streamId);
			this.recentBuffers.set(streamId, outputBuffer);
			void saveTerminalBuffer(workspaceId, streamId, outputBuffer);
			proc.kill();
			void onComplete(true);
		});
	}

	stopAll(): void {
		for (const [taskId] of this.running) {
			this.stopTask(taskId);
		}
		this.stopHomeAgent();
	}
}

// Returns the command + args to launch the MCP server.
// Dev: uses the absolute path to tsx from node_modules so Claude Code can find it
// regardless of its own PATH. Prod: node runs the bundled mcp-server.js.

export function getMcpServerPath(): { command: string; args: string[] } {
	const thisFile = fileURLToPath(import.meta.url);
	const thisDir = dirname(thisFile);
	const isDev = thisFile.endsWith(".ts");
	if (isDev) {
		const projectRoot = resolve(thisDir, "../..");
		return {
			command: resolve(projectRoot, "node_modules/.bin/tsx"),
			args: [resolve(thisDir, "../mcp/kanban-mcp-server.ts")],
		};
	}
	return {
		command: process.execPath,
		args: [resolve(thisDir, "mcp-server.js")],
	};
}

function buildHomeAgentSystemPrompt(repoPath: string): string {
	return `You are the Kanban Agent for the project at \`${repoPath}\`.

You help the developer manage their AI-driven Kanban board. You have MCP tools to interact with the board directly — always use them rather than guessing state.

# CRITICAL: You are NOT a coding agent

NEVER edit, create, or modify files in the workspace. Your only job is to manage the Kanban board using the MCP tools listed below. If the user asks you to write code or implement something, create a task card for it instead.

# Available MCP Tools

- \`kanban_get_board\` — fetch the live board state
- \`kanban_create_card\` — create a new task
- \`kanban_move_card\` — move a card to a different column
- \`kanban_update_card\` — update a card's title or description
- \`kanban_delete_card\` — delete a card
- \`kanban_add_comment\` — record a comment on a card`;
}

function buildHomeAgentInitialMessage(): string {
	return `Call kanban_get_board now, then greet the developer with a brief summary of the current board state and let them know you're ready to help.`;
}

function buildTaskAgentSystemPrompt(card: RuntimeBoardCard, customPrompt?: string): string {
	const parts = [`You are an autonomous coding agent working on a Kanban task.

Work autonomously without asking for permission or confirmation. You have full access to the codebase in your current working directory.

When you finish your work, call the \`kanban_add_comment\` MCP tool with:
- cardId: "${card.id}"
- type: "dev"
- passed: true
- content: a 3-6 sentence PR-ready summary of what you implemented, key decisions made, and any caveats`];

	if (customPrompt?.trim()) {
		parts.push(`## Project-specific instructions\n\n${customPrompt.trim()}`);
	}

	return parts.join("\n\n");
}

const COMMENT_TYPE_LABEL: Record<string, string> = {
	dev: "Dev Summary",
	code_review: "Code Review",
	qa: "QA",
	human: "Human Feedback",
};

const CONFLICT_RESOLUTION_SYSTEM_PROMPT = `You are a merge conflict resolution agent. Your only job is to resolve git merge conflicts.

Rules:
- Only edit files to remove conflict markers (<<<<<<< ======= >>>>>>>)
- Preserve the intent of BOTH sides where possible; when in doubt keep the incoming (task) changes
- Never refactor, rename, or change logic beyond resolving the conflict markers
- After resolving all conflicts: git add -A && git commit -m "Resolve merge conflicts"
- Exit when done`;

function buildConflictResolutionPrompt(card: RuntimeBoardCard, conflictedFiles: string[]): string {
	return `Resolve the git merge conflicts in this repository.

Task being merged: "${card.title}"

Conflicted files:
${conflictedFiles.map((f) => `- ${f}`).join("\n")}

Resolve each conflict, then run: git add -A && git commit -m "Resolve merge conflicts for: ${card.title}"`;
}

function buildTaskPrompt(card: RuntimeBoardCard): string {
	const parts = [`# Task: ${card.title}`, "", card.description];

	if (card.reviewComments && card.reviewComments.length > 0) {
		parts.push("", "## Previous Review Feedback (please address these issues)");
		for (const comment of card.reviewComments) {
			const label = COMMENT_TYPE_LABEL[comment.type] ?? comment.type;
			parts.push(``, `### ${label} (${comment.agent})`, comment.content);
		}
	}

	if (card.githubIssueUrl) {
		parts.push("", `GitHub Issue: ${card.githubIssueUrl}`);
	}

	return parts.join("\n");
}
