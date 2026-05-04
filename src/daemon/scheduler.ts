import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import { getAvailableAgents } from "../agents/agent-registry.js";
import { CLAUDE_HOME_MCP_CONFIG_PATH, CLAUDE_TASK_SETTINGS_PATH, buildTaskHookEnv, writeClaudeHomeSettings } from "../agents/agent-hooks.js";
import type { RuntimeAgentId, RuntimeBoardCard } from "../core/api-contract.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, appendTerminalSession, loadBoard, moveCard, removeSession, saveTerminalBuffer, updateCard, updateSession } from "../state/workspace-state.js";
import { createWorktree, getWorktreePath, removeWorktree } from "../worktree/worktree-manager.js";

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

		const prompt = buildHomeAgentPrompt(repoPath);
		await writeClaudeHomeSettings(getMcpServerPath(), serverUrl, workspaceId).catch((err) => {
			console.warn("[scheduler] Failed to write home agent MCP settings:", err);
		});

		const homeTask: RunningTask = {
			taskId,
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: repoPath,
				mcpConfigPath: agentId === "claude" ? CLAUDE_HOME_MCP_CONFIG_PATH : undefined,
				onOutput: (data) => {
					homeTask.outputBuffer += data;
					if (homeTask.outputBuffer.length > 65536) {
						homeTask.outputBuffer = homeTask.outputBuffer.slice(-65536);
					}
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

	canAcceptTask(): boolean {
		return this.running.size < this.options.maxParallelTasks;
	}

	async startTask(card: RuntimeBoardCard): Promise<void> {
		const { workspaceId, repoPath, stateHub } = this.options;
		const agentId = card.agentId ?? this.options.defaultAgent;
		const taskId = card.id;

		// Guard: check agent binary is available before spawning
		const available = getAvailableAgents().map((a) => a.id);
		if (!available.includes(agentId)) {
			console.error(`[scheduler] Agent "${agentId}" not found in PATH — blocking task "${card.title}"`);
			await moveCard(workspaceId, taskId, "blocked");
			await appendActivityLog(workspaceId, taskId, `Agent "${agentId}" not found in PATH — moved to Blocked`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}

		console.log(`[scheduler] Starting task ${taskId} "${card.title}" with agent ${agentId}`);

		// Create isolated worktree
		const worktree = createWorktree(taskId, repoPath, card.baseRef);

		// Build prompt from card
		const prompt = buildTaskPrompt(card);

		// Update session state
		await updateSession(workspaceId, taskId, {
			taskId,
			state: "running",
			agentId,
			worktreePath: worktree.path,
			startedAt: Date.now(),
		});

		// Move card to in_progress
		await moveCard(workspaceId, taskId, "in_progress");
		await appendActivityLog(workspaceId, taskId, `Agent ${agentId} started`);
		await appendTerminalSession(workspaceId, taskId, { streamId: taskId, type: "dev", startedAt: Date.now() });
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		const spawnedAt = Date.now();

		const runningTask: RunningTask = {
			taskId,
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: worktree.path,
				env: buildTaskHookEnv(taskId, workspaceId),
				hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
				onOutput: (data) => {
					runningTask.outputBuffer += data;
					if (runningTask.outputBuffer.length > 65536) {
						runningTask.outputBuffer = runningTask.outputBuffer.slice(-65536);
					}
					stateHub.broadcastTerminalOutput(workspaceId, taskId, data);
				},
				onExit: async (exitCode) => {
					this.recentBuffers.set(taskId, runningTask.outputBuffer);
					void saveTerminalBuffer(workspaceId, taskId, runningTask.outputBuffer);
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

					console.log(`[scheduler] Task ${taskId} exited with code ${exitCode} after ${Math.round(elapsed / 1000)}s`);

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
							console.error(`[scheduler] Task ${taskId} failed within ${Math.round(elapsed / 1000)}s — possible launch error`);
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
			console.log(`[scheduler] Stopping task ${taskId}`);
			task.process.kill();
			this.running.delete(taskId);
			void appendActivityLog(this.options.workspaceId, taskId, "Agent stopped manually");
		}
	}

	getOutputBuffer(taskId: string): string {
		return (
			this.running.get(taskId)?.outputBuffer ??
			this.homeSessions.get(taskId)?.outputBuffer ??
			this.recentBuffers.get(taskId) ??
			""
		);
	}

	resizeTerminal(taskId: string, cols: number, rows: number): void {
		const proc =
			this.running.get(taskId)?.process ??
			this.homeSessions.get(taskId)?.process ??
			this.liveProcesses.get(taskId);
		proc?.resize(cols, rows);
	}

	writeToTerminal(taskId: string, data: string): void {
		const proc =
			this.running.get(taskId)?.process ??
			this.homeSessions.get(taskId)?.process ??
			this.liveProcesses.get(taskId);
		proc?.write(data);
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
				this.recentBuffers.set(taskId, task.outputBuffer);
				void saveTerminalBuffer(workspaceId, taskId, task.outputBuffer);
				task.process.kill();
				this.running.delete(taskId);
			}

			await moveCard(workspaceId, taskId, "in_review");
			await appendActivityLog(workspaceId, taskId, "Agent finished → moved to In Review");
			await updateSession(workspaceId, taskId, { state: "awaiting_review" });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			console.log(`[scheduler] Hook Stop: task ${taskId} → in_review`);
			this.options.onTaskCompleted(taskId);
		} else if (event === "user_prompt") {
			const board = await loadBoard(workspaceId);
			const card = board.cards[taskId];
			if (!card || card.columnId !== "in_review") return;

			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "User continued → moved back to In Progress");
			await updateSession(workspaceId, taskId, { state: "running" });
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			console.log(`[scheduler] Hook UserPromptSubmit: task ${taskId} → in_progress`);
		}
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
function getMcpServerPath(): { command: string; args: string[] } {
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

function buildHomeAgentPrompt(repoPath: string): string {
	return `You are the Kanban Agent for the project at \`${repoPath}\`.

You help the developer manage their AI-driven Kanban board. You have MCP tools to interact with the board directly — always use them rather than guessing state.

Available tools:
- kanban_get_board — fetch the live board state
- kanban_create_card — create a new task
- kanban_move_card — move a card to a different column
- kanban_update_card — update a card's title or description
- kanban_delete_card — delete a card

Call kanban_get_board now, then greet the developer with a brief summary of the current board state and let them know you're ready to help.`;
}

function buildTaskPrompt(card: RuntimeBoardCard): string {
	const parts = [`# Task: ${card.title}`, "", card.description];

	if (card.reviewComments && card.reviewComments.length > 0) {
		parts.push("", "## Previous Review Feedback (please address these issues)");
		for (const comment of card.reviewComments) {
			parts.push(
				``,
				`### ${comment.type === "code_review" ? "Code Review" : "QA"} (${comment.agent})`,
				comment.content,
			);
		}
	}

	if (card.githubIssueUrl) {
		parts.push("", `GitHub Issue: ${card.githubIssueUrl}`);
	}

	return parts.join("\n");
}
