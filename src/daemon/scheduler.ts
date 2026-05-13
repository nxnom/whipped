import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildKanbomMcpServerSpec,
	buildTaskHookEnv,
	CLAUDE_HOME_MCP_CONFIG_PATH,
	CLAUDE_TASK_SETTINGS_PATH,
	getMcpConfigPath,
	getServerPort,
	writeClaudeHomeSettings,
	writeClaudeMcpConfig,
} from "../agents/agent-hooks.js";
import { getAvailableAgents } from "../agents/agent-registry.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type { RuntimeAgentId, RuntimeBoardCard, WorkflowSlot } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { commitIfDirty, pushBranch } from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	appendActivityLog,
	appendTerminalSession,
	clearCardSession,
	endTerminalSession,
	linkCommentToSession,
	loadBoard,
	loadProjectConfig,
	moveCard,
	saveTerminalBuffer,
	updateCard,
} from "../state/workspace-state.js";
import { createMergedWorktree, createWorktree, getCardBranch, getWorktreePath } from "../worktree/worktree-manager.js";
import {
	buildDevAgentSystemPrompt,
	buildSecretsEnv,
	buildSecretsSection,
	runParentReopenCascade,
	tryParseAgentJson,
} from "./review-pipeline.js";

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
const MAX_RECENT_BUFFERS = 100;

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
	// Tasks that were manually stopped — prevents onExit from running the failure path.
	private manuallyStoppedTasks = new Set<string>();
	// Same set but persists until handleHookEvent has consumed it — handles the race where
	// the Claude Code Stop hook fires (async HTTP) after stopTask() has already killed the process.
	private manuallyStoppedForHook = new Set<string>();
	// Tasks stopped because their parent was reopened — session set to "stopped" in onExit.
	private parentReopenedTasks = new Set<string>();
	// Set during graceful shutdown — onExit becomes a no-op to preserve cleanup state.
	private isShuttingDown = false;

	constructor(private options: SchedulerOptions) {}

	private setRecentBuffer(streamId: string, buffer: string): void {
		this.recentBuffers.set(streamId, buffer);
		if (this.recentBuffers.size > MAX_RECENT_BUFFERS) {
			this.recentBuffers.delete(this.recentBuffers.keys().next().value!);
		}
	}

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

		// Clear stale buffers so the new session starts with a blank terminal
		this.recentBuffers.delete(taskId);
		stateHub.clearTerminalBuffer(workspaceId, taskId);

		const prompt = "";
		await writeClaudeHomeSettings(getMcpServerPath(), serverUrl, workspaceId).catch((err) => {
			logger.warn({ err }, "[scheduler] Failed to write home agent MCP settings");
		});

		const projectConfig = await loadProjectConfig(workspaceId);
		const secrets = projectConfig.secrets ?? [];
		const secretsEnv = buildSecretsEnv(secrets);
		const appendSystemPrompt = buildHomeAgentSystemPrompt(repoPath, secrets, projectConfig.systemPrompt);

		const homeTask: RunningTask = {
			taskId,
			streamId: taskId, // home agent uses taskId as its stream (single session)
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: repoPath,
				env: secretsEnv,
				mcpConfigPath: agentId === "claude" ? CLAUDE_HOME_MCP_CONFIG_PATH : undefined,
				mcpServer:
					agentId === "codex" ? buildKanbomMcpServerSpec(getMcpServerPath(), serverUrl, workspaceId) : undefined,
				appendSystemPrompt,
				onOutput: (data) => {
					homeTask.outputBuffer += data;
					stateHub.broadcastTerminalOutput(workspaceId, taskId, data);
				},
				onExit: () => {
					this.setRecentBuffer(taskId, homeTask.outputBuffer);
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
		const taskId = card.id;

		// Reload project config early so we can resolve the dev slot + agent binary
		const projectConfig = await loadProjectConfig(workspaceId);
		const isStoryCard = card.type === "story";
		const cardWorkflow =
			projectConfig.workflows.find((w) => w.id === card.workflowId) ??
			projectConfig.workflows.find((w) => w.isDefault && w.forStory === isStoryCard) ??
			projectConfig.workflows.find((w) => w.forStory === isStoryCard) ??
			projectConfig.workflows[0];
		const devSlotEarly: WorkflowSlot = cardWorkflow?.slots.find((s) => s.type === "dev") ?? {
			id: "dev",
			type: "dev" as const,
			name: "Dev",
			agentBinary: "claude" as const,
			order: 0,
			enabled: true,
			prompt: "",
		};
		const agentId = card.agentId ?? devSlotEarly.agentBinary;

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
		let extraDepBranches: string[] = [];
		let parentCards: RuntimeBoardCard[] = [];
		if (card.dependsOn && card.dependsOn.length > 0) {
			const board = await loadBoard(workspaceId);
			const unmetDep = card.dependsOn.find((depId) => {
				const dep = board.cards[depId];
				return !dep || (dep.columnId !== "ready_for_review" && dep.columnId !== "done");
			});
			if (unmetDep) {
				await moveCard(workspaceId, taskId, "blocked");
				const depCard = board.cards[unmetDep];
				await appendActivityLog(
					workspaceId,
					taskId,
					`Blocked: dependency "${depCard?.title ?? unmetDep}" is not yet complete`,
				);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				return;
			}
			// Story cards run the orch workflow on the base branch — don't branch off subtask worktrees
			if (card.type !== "story") {
				// Collect all resolved dep branches in order; use last as primary base, merge in the rest.
				// Including "done" deps here is intentional — their branches are kept alive until all
				// dependents complete (see poller cleanup logic).
				const resolvedDepBranches: string[] = [];
				for (const depId of card.dependsOn) {
					const dep = board.cards[depId as string];
					if (dep?.columnId === "ready_for_review" || dep?.columnId === "done") {
						resolvedDepBranches.push(getCardBranch(dep));
					}
				}
				if (resolvedDepBranches.length > 0) {
					effectiveBaseRef = resolvedDepBranches[resolvedDepBranches.length - 1]!;
					extraDepBranches = resolvedDepBranches.slice(0, -1);
				}
				parentCards = card.dependsOn.map((id) => board.cards[id]).filter((c): c is RuntimeBoardCard => !!c);
			}
		}

		// Story cards have no dev phase — go straight to the orch review pipeline
		if (card.type === "story") {
			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "All subtasks complete → triggering orchestrator workflow");
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			this.options.onTaskCompleted(taskId);
			return;
		}

		// If the last session was failed (server stopped mid-run) and dev already passed
		// IN THIS SESSION, skip spawning the dev agent and hand off to review pipeline.
		// Guard: dev:pass must have been created during this session (createdAt >= last dev
		// terminal session's startedAt) so we don't reuse a dev:pass from a prior run.
		const lastDevComment = [...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev");
		const lastDevTs = card.terminalSessions
			?.slice()
			.reverse()
			.find((ts) => ts.type === "dev");
		const devPassedInThisSession =
			lastDevComment?.status === "pass" && lastDevTs !== undefined && lastDevComment.createdAt >= lastDevTs.startedAt;
		const lastTs = card.terminalSessions?.at(-1);
		logger.info(
			`[scheduler] Resume check for "${card.title}": lastTsState=${lastTs?.state} devPassedInThisSession=${devPassedInThisSession} lastDevComment=${lastDevComment?.status} lastDevTsStart=${lastDevTs?.startedAt} devCreatedAt=${lastDevComment?.createdAt}`,
		);
		if (lastTs?.state === "killed" && devPassedInThisSession) {
			extraDepBranches.length > 0
				? createMergedWorktree(taskId, repoPath, effectiveBaseRef, extraDepBranches, card.branchName)
				: createWorktree(taskId, repoPath, effectiveBaseRef, card.branchName);
			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "Dev already completed — resuming AI review from last killed step");
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			this.options.onTaskCompleted(taskId);
			return;
		}

		// Write MCP config so the dev agent can call kanban_add_comment when done.
		// Use a per-task path to avoid concurrent agents overwriting each other's config.
		const mcpConfigPath = getMcpConfigPath(taskId);
		await writeClaudeMcpConfig(
			getMcpServerPath(),
			this.options.serverUrl,
			workspaceId,
			agentId as string,
			mcpConfigPath,
		).catch(() => {});

		// Create isolated worktree; merge extra dep branches when card has multiple independent deps
		const worktree =
			extraDepBranches.length > 0
				? createMergedWorktree(taskId, repoPath, effectiveBaseRef, extraDepBranches, card.branchName)
				: createWorktree(taskId, repoPath, effectiveBaseRef, card.branchName);

		// Move card + set worktree path immediately so the UI reflects it before setup runs
		await updateCard(workspaceId, taskId, { worktreePath: worktree.path });
		await moveCard(workspaceId, taskId, "in_progress");
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		// Extracted so it can be called either directly or after conflict resolution completes.
		const launchDevAgent = async () => {
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
						try {
							cpSync(src, dst, { recursive: true });
							copied.push(relPath);
						} catch {
							/* best-effort */
						}
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
						proc.on("close", (code) => {
							if (code !== 0) {
								logger.error(`[scheduler] Install command failed (code ${code}) for task ${taskId}`);
								void appendActivityLog(
									workspaceId,
									taskId,
									`Install command failed (code ${code}) — proceeding anyway`,
								);
							}
							resolve();
						});
					});
					await appendActivityLog(workspaceId, taskId, "Install complete");
					stateHub.broadcastWorkspaceUpdate(workspaceId);
				}
			}

			const prompt = buildTaskPrompt();
			const secrets = projectConfig.secrets ?? [];
			const devSystemPromptResult = buildDevAgentSystemPrompt(
				devSlotEarly,
				card,
				devSlotEarly.prompt ?? "",
				worktree.path,
				secrets,
				parentCards,
				projectConfig.systemPrompt,
			);
			const secretsEnv = buildSecretsEnv(secrets);

			await appendActivityLog(workspaceId, taskId, `Agent ${agentId} started`);

			const spawnedAt = Date.now();
			const devStreamId = `${taskId}-dev-${spawnedAt}`;

			await appendTerminalSession(workspaceId, taskId, {
				streamId: devStreamId,
				type: "dev",
				startedAt: spawnedAt,
				agentId,
				state: "running",
			});
			stateHub.broadcastWorkspaceUpdate(workspaceId);

			const runningTask: RunningTask = {
				taskId,
				streamId: devStreamId,
				agentId,
				process: spawnAgent({
					agentId,
					prompt,
					cwd: worktree.path,
					env: { ...buildTaskHookEnv(taskId, workspaceId), ...secretsEnv },
					hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
					hookServerPort: agentId === "codex" ? getServerPort(this.options.serverUrl) : undefined,
					mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
					mcpServer:
						agentId === "codex"
							? buildKanbomMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId, agentId)
							: undefined,
					appendSystemPrompt: devSystemPromptResult.text,
					files: agentId === "claude" ? devSystemPromptResult.files : undefined,
					effort: devSlotEarly.effort ?? undefined,
					model: devSlotEarly.model ?? undefined,
					onOutput: (data) => {
						runningTask.outputBuffer += data;
						stateHub.broadcastTerminalOutput(workspaceId, devStreamId, data);
					},
					onExit: async (exitCode) => {
						this.setRecentBuffer(devStreamId, runningTask.outputBuffer);
						void saveTerminalBuffer(workspaceId, devStreamId, runningTask.outputBuffer);
						this.running.delete(taskId);
						unlink(mcpConfigPath).catch(() => {});

						// Graceful shutdown already persisted the failed/todo state — bail out.
						if (this.isShuttingDown) return;

						// If manually stopped, clear the session so the card can be restarted.
						if (this.manuallyStoppedTasks.has(taskId)) {
							this.manuallyStoppedTasks.delete(taskId);
							this.manuallyStoppedForHook.delete(taskId);
							await endTerminalSession(workspaceId, taskId, devStreamId, Date.now(), "stopped");
							await clearCardSession(workspaceId, taskId);
							// Move back to todo only if handleHookEvent hasn't already done it
							const stoppedBoard = await loadBoard(workspaceId);
							const stoppedCard = stoppedBoard.cards[taskId];
							if (stoppedCard?.columnId === "in_progress") {
								await moveCard(workspaceId, taskId, "todo");
								await updateCard(workspaceId, taskId, { readyForDev: false });
								await appendActivityLog(workspaceId, taskId, "Moved back to Todo");
							}
							stateHub.broadcastWorkspaceUpdate(workspaceId);
							return;
						}

						// If stopped due to parent reopen, mark session as stopped (not failed).
						if (this.parentReopenedTasks.has(taskId)) {
							this.parentReopenedTasks.delete(taskId);
							await endTerminalSession(workspaceId, taskId, devStreamId, Date.now(), "stopped");
							stateHub.broadcastWorkspaceUpdate(workspaceId);
							return;
						}

						// Synchronous check — must happen before any await.
						// The Stop hook sets this flag before calling kill() so that when
						// onExit fires (synchronously during kill), we skip the duplicate
						// onTaskCompleted call and card transition entirely.
						if (this.hookHandledTasks.has(taskId)) {
							this.hookHandledTasks.delete(taskId);
							const exitedAt = Date.now();
							// Set endedAt on any dev comment stored via MCP
							const hookBoard = await loadBoard(workspaceId);
							const hookCard = hookBoard.cards[taskId];
							const hookDevComment = hookCard?.reviewComments
								?.slice()
								.reverse()
								.find((c) => c.type === "dev" && c.createdAt >= spawnedAt);
							if (hookDevComment) {
								await linkCommentToSession(workspaceId, taskId, hookDevComment.createdAt, devStreamId);
							}
							await endTerminalSession(workspaceId, taskId, devStreamId, exitedAt, "completed");
							stateHub.broadcastWorkspaceUpdate(workspaceId);
							return;
						}

						const elapsed = Date.now() - spawnedAt;
						const isFastExit = elapsed < FAST_EXIT_THRESHOLD_MS;
						const exitedAt = Date.now();

						logger.info(`[scheduler] Task ${taskId} exited with code ${exitCode} after ${Math.round(elapsed / 1000)}s`);

						// Check if agent stored a dev comment via MCP; if not, create a fallback
						const exitBoard = await loadBoard(workspaceId);
						const exitCard = exitBoard.cards[taskId];
						const existingDevComment = exitCard?.reviewComments
							?.slice()
							.reverse()
							.find((c) => c.type === "dev" && c.createdAt >= spawnedAt);
						const devState = exitCode === 0 ? "completed" : "failed";
						if (existingDevComment) {
							await linkCommentToSession(workspaceId, taskId, existingDevComment.createdAt, devStreamId);
							await endTerminalSession(workspaceId, taskId, devStreamId, exitedAt, devState);
						} else {
							// Non-MCP fallback comment
							const parsed = tryParseAgentJson(runningTask.outputBuffer);
							const fallbackComment: import("../core/api-contract.js").RuntimeReviewComment = {
								type: "dev",
								actor: { type: "ai", id: agentId },
								status: exitCode === 0 ? "pass" : "fail",
								createdAt: exitedAt,
								streamId: devStreamId,
								summary: parsed?.summary ?? "Agent completed.",
								issues: parsed?.issues,
								metadata: parsed?.metadata,
							};
							const existing = exitCard?.reviewComments ?? [];
							await updateCard(workspaceId, taskId, { reviewComments: [...existing, fallbackComment] });
							await endTerminalSession(workspaceId, taskId, devStreamId, exitedAt, devState);
						}

						if (exitCode === 0) {
							const hasReviewSlots = (cardWorkflow?.slots ?? []).some((s) => s.type !== "dev" && s.enabled);
							if (!hasReviewSlots) {
								await moveCard(workspaceId, taskId, "ready_for_review");
								await appendActivityLog(workspaceId, taskId, "Agent finished → moved to Ready for Review");
							} else {
								await appendActivityLog(workspaceId, taskId, "Agent finished → AI review starting");
							}
						} else {
							const latestBoard = await loadBoard(workspaceId);
							const latestCard = latestBoard.cards[taskId] ?? card;
							const newAttempts = latestCard.autoFixAttempts + 1;
							await updateCard(workspaceId, taskId, { autoFixAttempts: newAttempts });
							const destination = newAttempts >= this.options.maxAutoFixAttempts ? "blocked" : "reopened";

							if (isFastExit) {
								logger.error(
									`[scheduler] Task ${taskId} failed within ${Math.round(elapsed / 1000)}s — possible launch error`,
								);
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
							// Worktree is intentionally kept when blocked so prior commits survive a manual restart
						}
						stateHub.broadcastWorkspaceUpdate(workspaceId);
						this.options.onTaskCompleted(taskId);
					},
				}),
				startedAt: spawnedAt,
				outputBuffer: "",
			};

			this.running.set(taskId, runningTask);
		};

		if (worktree.conflictedFiles.length > 0) {
			await appendActivityLog(
				workspaceId,
				taskId,
				`Merging dependency branches → conflicts in: ${worktree.conflictedFiles.join(", ")} — resolving...`,
			);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			await this.startConflictResolution(card, worktree.path, worktree.conflictedFiles, async (success) => {
				if (success) {
					await appendActivityLog(
						workspaceId,
						taskId,
						`Dep branch conflicts resolved (${worktree.conflictedFiles.join(", ")}) — starting dev agent`,
					);
					stateHub.broadcastWorkspaceUpdate(workspaceId);
					await launchDevAgent();
				} else {
					await moveCard(workspaceId, taskId, "blocked");
					await appendActivityLog(workspaceId, taskId, "Could not resolve dep merge conflicts → Blocked");
					stateHub.broadcastWorkspaceUpdate(workspaceId);
				}
			});
		} else {
			await launchDevAgent();
		}
	}

	stopTask(taskId: string): void {
		const task = this.running.get(taskId);
		if (task) {
			logger.info(`[scheduler] Stopping task ${taskId}`);
			this.manuallyStoppedTasks.add(taskId);
			this.manuallyStoppedForHook.add(taskId);
			task.process.kill();
			this.running.delete(taskId);
			void appendActivityLog(this.options.workspaceId, taskId, "Agent stopped manually");
		}
	}

	// Stop a task because its parent was reopened — session becomes "stopped" rather than being removed.
	interruptForParentReopen(taskId: string): void {
		const task = this.running.get(taskId);
		if (task) {
			logger.info(`[scheduler] Interrupting task ${taskId} due to parent reopen`);
			this.setRecentBuffer(task.streamId, task.outputBuffer);
			void saveTerminalBuffer(this.options.workspaceId, task.streamId, task.outputBuffer);
			this.parentReopenedTasks.add(taskId);
			task.process.kill();
			this.running.delete(taskId);
		}
	}

	async triggerParentReopenCascade(
		parentCard: RuntimeBoardCard,
		boardCards: Record<string, RuntimeBoardCard>,
	): Promise<void> {
		if (parentCard.type !== "task") return;

		const { workspaceId, repoPath, serverUrl, stateHub } = this.options;

		const childCards = Object.values(boardCards).filter(
			(card) =>
				card.dependsOn?.includes(parentCard.id) &&
				(card.columnId === "in_progress" || card.columnId === "ready_for_review"),
		);

		if (childCards.length === 0) return;

		logger.info(
			`[scheduler] triggerParentReopenCascade: ${childCards.length} children for parent "${parentCard.title}"`,
		);

		const projectConfig = await loadProjectConfig(workspaceId);
		void runParentReopenCascade(parentCard, childCards, {
			workspaceId,
			repoPath,
			serverUrl,
			mcpBinary: getMcpServerPath(),
			stateHub,
			secrets: projectConfig.secrets ?? [],
			registerStopCallback: this.registerStopCallback.bind(this),
			registerLiveProcess: this.registerLiveProcess.bind(this),
			onChildReset: async (child) => {
				const latestBoard = await loadBoard(workspaceId);
				await this.triggerParentReopenCascade(child, latestBoard.cards);
			},
		});
	}

	getOutputBuffer(streamId: string): string | null {
		// Active dev tasks: look up by streamId (unique per run)
		for (const task of this.running.values()) {
			if (task.streamId === streamId) return task.outputBuffer;
		}
		// Home agent sessions use taskId as their streamId
		const homeSession = this.homeSessions.get(streamId);
		if (homeSession) return homeSession.outputBuffer;
		// Completed tasks / recent buffers
		return this.recentBuffers.get(streamId) ?? null;
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

			// If the stop was triggered manually via stopTask(), move the card back to
			// todo (readyForDev=false) instead of treating it as "agent finished".
			if (this.manuallyStoppedForHook.has(taskId)) {
				this.manuallyStoppedForHook.delete(taskId);
				const task = this.running.get(taskId);
				if (task) {
					this.setRecentBuffer(task.streamId, task.outputBuffer);
					void saveTerminalBuffer(workspaceId, task.streamId, task.outputBuffer);
					task.process.kill();
					this.running.delete(taskId);
				}
				await moveCard(workspaceId, taskId, "todo");
				await updateCard(workspaceId, taskId, { readyForDev: false });
				await appendActivityLog(workspaceId, taskId, "Moved back to Todo");
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				logger.info(`[scheduler] Hook Stop (manual): task ${taskId} → todo`);
				return;
			}

			// Mark before killing — onExit checks this synchronously to skip the
			// duplicate onTaskCompleted call (kill fires onExit before moveCard runs).
			this.hookHandledTasks.add(taskId);
			const task = this.running.get(taskId);
			if (task) {
				this.setRecentBuffer(task.streamId, task.outputBuffer);
				void saveTerminalBuffer(workspaceId, task.streamId, task.outputBuffer);
				task.process.kill();
				this.running.delete(taskId);
			}

			if (card.githubPrUrl) {
				const worktreePath = getWorktreePath(taskId);
				const taskBranch = getCardBranch(card);
				await commitIfDirty(worktreePath, card.title);
				await pushBranch(worktreePath, taskBranch).then(
					() => appendActivityLog(workspaceId, taskId, `Pushed to PR`),
					(err: Error) => appendActivityLog(workspaceId, taskId, `Push failed: ${err.message}`),
				);
			}
			const hookConfig = await loadProjectConfig(workspaceId);
			const hookWorkflow =
				hookConfig.workflows.find((w) => w.id === card.workflowId) ??
				hookConfig.workflows.find((w) => w.isDefault) ??
				hookConfig.workflows[0];
			const hookHasReview = (hookWorkflow?.slots ?? []).some((s) => s.type !== "dev" && s.enabled);
			if (!hookHasReview) {
				await moveCard(workspaceId, taskId, "ready_for_review");
				await appendActivityLog(workspaceId, taskId, "Agent finished → moved to Ready for Review");
			} else {
				await appendActivityLog(workspaceId, taskId, "Agent finished → AI review starting");
			}
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			logger.info(
				`[scheduler] Hook Stop: task ${taskId} → ${hookHasReview ? "in_progress (review pending)" : "ready_for_review"}`,
			);
			this.options.onTaskCompleted(taskId);
		} else if (event === "user_prompt") {
			const board = await loadBoard(workspaceId);
			const card = board.cards[taskId];
			if (!card || card.columnId !== "ready_for_review") return;

			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "User continued → moved back to In Progress");
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

		await appendTerminalSession(workspaceId, card.id, {
			streamId,
			type: "conflict",
			startedAt: Date.now(),
			state: "running",
		});
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		let outputBuffer = "";
		let hookHandled = false;

		const proc = spawnAgent({
			agentId: defaultAgent,
			prompt: buildConflictResolutionPrompt(card, conflictedFiles),
			cwd: mergeWorktreePath,
			hookSettingsPath: defaultAgent === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			hookServerPort: defaultAgent === "codex" ? getServerPort(this.options.serverUrl) : undefined,
			env: buildTaskHookEnv(streamId, workspaceId),
			appendSystemPrompt: CONFLICT_RESOLUTION_SYSTEM_PROMPT,
			onOutput: (data) => {
				outputBuffer += data;
				stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
			},
			onExit: async (exitCode) => {
				this.liveProcesses.delete(streamId);
				this.setRecentBuffer(streamId, outputBuffer);
				void saveTerminalBuffer(workspaceId, streamId, outputBuffer);
				await endTerminalSession(workspaceId, card.id, streamId, Date.now(), exitCode === 0 ? "completed" : "failed");
				if (!hookHandled) await onComplete(exitCode === 0);
			},
		});

		this.liveProcesses.set(streamId, proc);

		this.registerStopCallback(streamId, () => {
			hookHandled = true;
			this.liveProcesses.delete(streamId);
			this.setRecentBuffer(streamId, outputBuffer);
			void saveTerminalBuffer(workspaceId, streamId, outputBuffer);
			void endTerminalSession(workspaceId, card.id, streamId, Date.now(), "completed");
			proc.kill();
			onComplete(true).catch((err) => logger.error({ err }, `[scheduler] conflict onComplete failed for ${card.id}:`));
		});
	}

	stopAll(): void {
		for (const [taskId] of this.running) {
			this.stopTask(taskId);
		}
		this.stopHomeAgent();
	}

	// Call before stopAll() during graceful shutdown so onExit handlers bail out
	// and do not overwrite the failed/todo state written by cleanupStaleTasks().
	prepareShutdown(): void {
		this.isShuttingDown = true;
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

function buildHomeAgentSystemPrompt(
	repoPath: string,
	secrets: import("../core/api-contract.js").RuntimeProjectSecret[] = [],
	systemPrompt?: string,
): string {
	const secretsSection = buildSecretsSection(secrets);

	return `You are the Assistant for the project at \`${repoPath}\`.

You are a conversational project assistant. You can discuss the project, help plan work, answer questions about the codebase, workflows, and board state, and help the developer decide what to build. You also have full control over the Kanban board and workflows via MCP tools.

# What you can do

- **Discuss & plan**: Talk through ideas, requirements, tradeoffs, and implementation strategies before any tickets are created
- **Answer questions**: About the project, its current board state, workflows, or anything the developer asks
- **Manage the board**: Create, update, move, or delete cards once the developer is ready
- **Configure workflows**: Suggest and save agent workflows tailored to the project
- **Migrate tickets**: Help import tasks from external tools (Jira, Monday.com, etc.) by turning them into board cards

# Important constraints

- Do NOT edit, create, or modify source code files in the workspace — if the developer wants code written, create a task card for the coding agent instead
- Always fetch live state with MCP tools rather than guessing — board and workflow state can change between messages

# Available MCP Tools

## Board
- \`kanban_get_board\` — fetch the live board state (cards, columns, current status)
- \`kanban_create_card\` — create a single task card (type: "task" by default; also accepts "story" or "subtask")
- \`kanban_create_story\` — create a story with all its subtasks in one call (preferred for stories)
- \`kanban_move_card\` — move a card to a different column
- \`kanban_update_card\` — update a card's title, description, priority, or dependencies
- \`kanban_delete_card\` — delete a card
- \`kanban_add_comment\` — record a comment on a card

## Workflows
- \`kanban_get_workflows\` — list all workflows (task and story/orch) with their agent slots, models, and prompts
- \`kanban_upsert_workflow\` — create or fully replace a workflow (pass complete workflow object)

# Card types

**task** — a normal development ticket. Runs dev → code_review → qa (based on workflow).

**story** — an epic with child subtasks. After ALL subtasks complete, the story runs its orchestrator (orch) workflow which reviews the whole picture and may reopen subtasks. Use \`kanban_create_story\` to create one atomically.

**subtask** — a child of a story. Runs its own full dev workflow. Created automatically by \`kanban_create_story\`, or manually via \`kanban_create_card\` with type: "subtask". Always set readyForDev: true.

# Workflow guidance

When asked to suggest or create a workflow:
1. Call \`kanban_get_board\` to understand the project type and existing tasks
2. Call \`kanban_get_workflows\` to see what already exists — note that task and story workflows are separate
3. Suggest appropriate agent slots and write focused, specific prompts for each slot
4. Use \`kanban_upsert_workflow\` to save
   - Task workflows: always include a dev slot (type: "dev", order: 0). Add code_review, qa, or custom slots as needed.
   - Story workflows: use only orch slots (type: "orch"). Set forStory: true.

Slot prompts should be specific to the project's domain and the slot's role.${secretsSection ? `\n\n${secretsSection}` : ""}${systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : ""}`;
}

const CONFLICT_RESOLUTION_SYSTEM_PROMPT = `You are a merge conflict resolution agent. Your only job is to resolve git merge conflicts.

Rules:
- Only edit files to remove conflict markers (<<<<<<< ======= >>>>>>>)
- Preserve the intent of BOTH sides where possible; when in doubt keep the incoming (task) changes
- Never refactor, rename, or change logic beyond resolving the conflict markers
- Exit when done`;

function buildConflictResolutionPrompt(card: RuntimeBoardCard, conflictedFiles: string[]): string {
	const descriptionSection = card.description?.trim() ? `\nTask description:\n${card.description.trim()}\n` : "";
	return `Resolve the git merge conflicts in this repository.

Task being merged: "${card.title}"
${descriptionSection}
Conflicted files:
${conflictedFiles.map((f) => `- ${f}`).join("\n")}

Resolve each conflict, preserving the task's intent. Then run:
git add -A && git commit -m "Resolve merge conflicts for: ${card.title}"`;
}

function buildTaskPrompt(): string {
	return "Start";
}
