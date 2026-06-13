import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildMcpRoleArgs,
	buildWhippedMcpServerSpec,
	buildTaskHookEnv,
	CLAUDE_ASSISTANT_MCP_CONFIG_PATH,
	CLAUDE_TASK_SETTINGS_PATH,
	cleanupCursorConfigDir,
	cleanupPluginAgentFiles,
	CURSOR_CONFIG_DIR_ENV,
	getCursorConfigDir,
	getMcpConfigPath,
	getServerPort,
	isPluginConfigAgent,
	pluginAgentConfigDirEnv,
	writeClaudeAssistantSettings,
	writeClaudeMcpConfig,
	writeCursorConfigFiles,
	writePluginAgentFiles,
} from "../agents/agent-hooks.js";
import { getAvailableAgents } from "../agents/agent-registry.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import {
	DEFAULT_GIT_INSTRUCTIONS,
	DEFAULT_MODEL_PAIR,
	EMPTY_INLINE_PROMPT,
	isResumableSessionState,
	resolvePair,
	resolveWorkflowForCard,
	type RuntimeAgentId,
	type RuntimeBoardCard,
	type WorkflowSlot,
} from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { resolvePromptText } from "../core/prompt-resolver.js";
import { generateTaskId } from "../core/task-id.js";
import { commitIfDirty, pushBranch } from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { buildMemoryContext } from "../state/memory-store.js";
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
import {
	createWorktree,
	getCardBranch,
	resolveWorktreeOwnerId,
	getWorktreePath,
	titleToBranch,
} from "../worktree/worktree-manager.js";
import {
	buildDevAgentSystemPrompt,
	buildSecretsEnv,
	buildSecretsSection,
	runParentReopenCascade,
	runPlanPhase,
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
	worktreeOwnerId?: string; // set when card shares another card's worktree; used to release sibling lock
}

const FAST_EXIT_THRESHOLD_MS = 8_000;
const MAX_RECENT_BUFFERS = 100;

const ASSISTANT_AGENT_PREFIX = "__assistant__:";

export class TaskScheduler {
	private running = new Map<string, RunningTask>();
	private assistantSessions = new Map<string, RunningTask>();
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
	// Tasks stopped before the dev agent started (e.g. during plan phase).
	private planPhaseManuallyStopped = new Set<string>();
	// Individual review/cascade stream IDs stopped by a manual stopTask() call.
	private manuallyStoppedStreams = new Set<string>();
	// Tasks stopped because their parent was reopened — session set to "stopped" in onExit.
	private parentReopenedTasks = new Set<string>();
	// Shared worktree IDs currently in use by a dev agent — prevents sibling cards from
	// running concurrently in the same worktree directory.
	private runningSharedWorktrees = new Set<string>();
	// Tasks whose startTask() is mid-flight. `running` is only populated after the
	// async worktree-create + spawn setup, so this set is the synchronous guard
	// that stops the poller from dispatching the same card multiple times while it
	// is still being launched.
	private startingTasks = new Set<string>();
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

	get assistantAgentTaskId(): string {
		return `${ASSISTANT_AGENT_PREFIX}${this.options.workspaceId}`;
	}

	async startAssistantAgent(): Promise<string> {
		const { workspaceId, repoPath, serverUrl, stateHub, defaultAgent } = this.options;
		const taskId = this.assistantAgentTaskId;

		// Stop any existing session first
		const existing = this.assistantSessions.get(taskId);
		if (existing) {
			existing.process.kill();
			this.assistantSessions.delete(taskId);
		}

		// Clear stale buffers so the new session starts with a blank terminal
		this.recentBuffers.delete(taskId);
		stateHub.clearTerminalBuffer(workspaceId, taskId);

		const prompt = "";

		const projectConfig = await loadProjectConfig(workspaceId);
		// The assistant's binary/model/effort are configurable (default: project/global
		// default agent). Falls back to defaultAgent when no assistantModel is set.
		const assistantModel = projectConfig.assistantModel;
		const agentId = assistantModel?.agentId ?? defaultAgent;
		const secrets = projectConfig.secrets ?? [];
		const secretsEnv = buildSecretsEnv(secrets);
		const assistantSystemPrompt = buildAssistantAgentSystemPrompt(repoPath, secrets, projectConfig.systemPrompt);
		const memContext = buildMemoryContext(workspaceId);
		const appendSystemPrompt = memContext ? `${memContext}\n\n${assistantSystemPrompt}` : assistantSystemPrompt;

		if (agentId === "claude") {
			await writeClaudeAssistantSettings(getMcpServerPath(), serverUrl, workspaceId).catch((err) => {
				logger.warn({ err }, "[scheduler] Failed to write assistant agent MCP settings");
			});
		} else if (isPluginConfigAgent(agentId)) {
			const mcpSpec = buildWhippedMcpServerSpec(
				getMcpServerPath(),
				serverUrl,
				workspaceId,
				undefined,
				buildMcpRoleArgs("assistant"),
			);
			await writePluginAgentFiles(agentId, taskId, getServerPort(serverUrl), mcpSpec, { appendSystemPrompt }).catch(
				(err) => {
					logger.warn({ err }, `[scheduler] Failed to write ${agentId} assistant agent files`);
				},
			);
		} else if (agentId === "cursor") {
			const mcpSpec = buildWhippedMcpServerSpec(
				getMcpServerPath(),
				serverUrl,
				workspaceId,
				undefined,
				buildMcpRoleArgs("assistant"),
			);
			await writeCursorConfigFiles(taskId, getServerPort(serverUrl), mcpSpec).catch((err) => {
				logger.warn({ err }, "[scheduler] Failed to write cursor assistant agent config");
			});
		}

		const assistantTask: RunningTask = {
			taskId,
			streamId: taskId, // assistant agent uses taskId as its stream (single session)
			agentId,
			process: spawnAgent({
				agentId,
				prompt,
				cwd: repoPath,
				env: {
					...secretsEnv,
					...buildTaskHookEnv(taskId, workspaceId),
					WHIPPED_SLOT: "assistant",
					...pluginAgentConfigDirEnv(agentId, taskId),
					...(agentId === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(taskId) } : {}),
				},
				mcpConfigPath: agentId === "claude" ? CLAUDE_ASSISTANT_MCP_CONFIG_PATH : undefined,
				mcpServer:
					agentId === "codex"
						? buildWhippedMcpServerSpec(
								getMcpServerPath(),
								serverUrl,
								workspaceId,
								undefined,
								buildMcpRoleArgs("assistant"),
							)
						: undefined,
				model: assistantModel?.model ?? null,
				effort: assistantModel?.effort ?? null,
				appendSystemPrompt: isPluginConfigAgent(agentId) ? undefined : appendSystemPrompt,
				onOutput: (data) => {
					assistantTask.outputBuffer += data;
					stateHub.broadcastTerminalOutput(workspaceId, taskId, data);
				},
				onExit: () => {
					this.setRecentBuffer(taskId, assistantTask.outputBuffer);
					this.assistantSessions.delete(taskId);
				},
			}),
			startedAt: Date.now(),
			outputBuffer: "",
		};

		this.assistantSessions.set(taskId, assistantTask);
		return taskId;
	}

	stopAssistantAgent(): void {
		const taskId = this.assistantAgentTaskId;
		const assistant = this.assistantSessions.get(taskId);
		if (assistant) {
			assistant.process.kill();
			this.assistantSessions.delete(taskId);
		}
	}

	isAssistantAgentRunning(): boolean {
		return this.assistantSessions.has(this.assistantAgentTaskId);
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

	// True while the scheduler is launching or running a dev agent for this card.
	// `running` is only populated after the (slow) worktree-create + install setup,
	// and the dev terminal session isn't registered until then either — so during the
	// launch window the card is already in_progress with no open session. The poller's
	// restart-recovery fallback uses this to avoid triggering the review pipeline mid-launch.
	isHandlingTask(taskId: string): boolean {
		return this.running.has(taskId) || this.startingTasks.has(taskId) || this.planPhaseManuallyStopped.has(taskId);
	}

	// Public entry — synchronous in-flight guard wraps the real launch. The poller
	// can dispatch the same card again before it has moved out of `todo` (worktree
	// creation is slow); this prevents that from spawning duplicate dev agents.
	async startTask(card: RuntimeBoardCard): Promise<void> {
		const taskId = card.id;
		if (this.running.has(taskId) || this.startingTasks.has(taskId)) {
			return;
		}
		this.startingTasks.add(taskId);
		try {
			await this.startTaskInner(card);
		} finally {
			this.startingTasks.delete(taskId);
		}
	}

	private async startTaskInner(card: RuntimeBoardCard): Promise<void> {
		const { workspaceId, repoPath, stateHub } = this.options;
		const taskId = card.id;

		// Reload project config early so we can resolve the dev slot + agent binary
		const projectConfig = await loadProjectConfig(workspaceId);
		const cardWorkflow = resolveWorkflowForCard(projectConfig.workflows, card);
		const devSlotEarly: WorkflowSlot = cardWorkflow?.slots.find((s) => s.type === "dev") ?? {
			id: "dev",
			type: "dev" as const,
			name: "Dev",
			order: 0,
			enabled: true,
			prompt: EMPTY_INLINE_PROMPT,
			pairs: [DEFAULT_MODEL_PAIR],
			mode: "auto",
			tools: [],
			canAdjustLevel: false,
			rerun: false,
		};
		// Resolve the concrete model pair from the card's snapshot (preferred) or the
		// slot template, using the card's workflow-wide active level.
		const devModelCfg = card.modelConfig?.[devSlotEarly.id] ?? {
			pairs: devSlotEarly.pairs,
			mode: devSlotEarly.mode,
		};
		const devPair = resolvePair(devModelCfg, card.activeLevel);
		const agentId = card.agentId ?? devPair.binary;

		// Guard: check agent binary is available before spawning
		const available = getAvailableAgents().map((a) => a.id);
		if (!available.includes(agentId)) {
			logger.error(
				`[scheduler] Agent "${agentId}" not found in PATH — blocking task "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
			);
			await moveCard(workspaceId, taskId, "blocked");
			await appendActivityLog(workspaceId, taskId, `Agent "${agentId}" not found in PATH — moved to Blocked`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}

		logger.info(
			`[scheduler] Starting task ${taskId} "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" with agent ${agentId}`,
		);

		// Resolve the worktree owner from the relation graph (story subtask → story,
		// dependsOn chain → root, else self). No persisted owner field to drift.
		const board = await loadBoard(workspaceId);
		const effectiveWorktreeId = resolveWorktreeOwnerId(card.id, board.cards);
		const hasSharedWorktree = effectiveWorktreeId !== card.id;

		// Sibling lock: prevent two cards from running concurrently in the same shared worktree.
		if (hasSharedWorktree && this.runningSharedWorktrees.has(effectiveWorktreeId)) {
			logger.info(
				`[scheduler] Shared worktree ${effectiveWorktreeId} busy — deferring "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
			);
			return;
		}
		if (hasSharedWorktree) this.runningSharedWorktrees.add(effectiveWorktreeId);

		// Gate on this card's relations. Each relation has its own readiness rule:
		//   story     → every subtask must be in ready_for_review (then run orchestrator)
		//   dependsOn → the single parent must be in ready_for_review (stacked on its worktree)
		//   waitsFor  → every listed card must be done/merged (fresh worktree from baseRef)
		let parentCards: RuntimeBoardCard[] = [];
		let siblingCards: RuntimeBoardCard[] = [];

		const describeCard = (id: string): string => {
			const c = board.cards[id];
			return c ? (c.description?.split("\n")[0]?.slice(0, 60) ?? c.id) : id;
		};
		const blockOnUnmet = async (reason: string): Promise<void> => {
			if (hasSharedWorktree) this.runningSharedWorktrees.delete(effectiveWorktreeId);
			await moveCard(workspaceId, taskId, "blocked");
			await appendActivityLog(workspaceId, taskId, reason);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
		};

		if (card.type === "story") {
			const unmet = (card.subtaskIds ?? []).find((id) => board.cards[id]?.columnId !== "ready_for_review");
			if (unmet) {
				await blockOnUnmet(`Blocked: subtask "${describeCard(unmet)}" is not yet in Ready for Review`);
				return;
			}
		} else if (card.dependsOn) {
			const parent = board.cards[card.dependsOn];
			if (!parent || parent.columnId !== "ready_for_review") {
				await blockOnUnmet(`Blocked: dependency "${describeCard(card.dependsOn)}" is not yet in Ready for Review`);
				return;
			}
			parentCards = [parent];
		} else if ((card.waitsFor ?? []).length > 0) {
			const unmet = card.waitsFor.find((id) => board.cards[id]?.columnId !== "done");
			if (unmet) {
				await blockOnUnmet(`Blocked: waiting for "${describeCard(unmet)}" to be done`);
				return;
			}
			// No parentCards: waitsFor parents are done and already merged into baseRef, so their
			// code is present in this card's fresh worktree. Injecting their dev summaries would only
			// risk misleading the agent (a later card may have refactored away the summarized work).
		}

		if (hasSharedWorktree) {
			siblingCards = Object.values(board.cards).filter(
				(c) =>
					c.id !== card.id &&
					c.columnId === "ready_for_review" &&
					resolveWorktreeOwnerId(c.id, board.cards) === effectiveWorktreeId,
			);
		}

		// Story cards have no dev phase — go straight to the orch review pipeline
		if (card.type === "story") {
			if (hasSharedWorktree) this.runningSharedWorktrees.delete(effectiveWorktreeId);
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
			`[scheduler] Resume check for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}": lastTsState=${lastTs?.state} devPassedInThisSession=${devPassedInThisSession} lastDevComment=${lastDevComment?.status} lastDevTsStart=${lastDevTs?.startedAt} devCreatedAt=${lastDevComment?.createdAt}`,
		);
		if (isResumableSessionState(lastTs?.state) && devPassedInThisSession) {
			createWorktree(effectiveWorktreeId, repoPath, card.baseRef, hasSharedWorktree ? undefined : card.branchName);
			if (hasSharedWorktree) this.runningSharedWorktrees.delete(effectiveWorktreeId);
			await moveCard(workspaceId, taskId, "in_progress");
			await appendActivityLog(workspaceId, taskId, "Dev already completed — resuming AI review from last session");
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			this.options.onTaskCompleted(taskId);
			return;
		}

		// Write agent-specific config so the dev agent can call kanban_add_comment when done
		// and fire the Stop hook when it finishes a turn.
		const mcpConfigPath = !isPluginConfigAgent(agentId) && agentId !== "cursor" ? getMcpConfigPath(taskId) : undefined;

		// For shared-worktree cards, look up the owner card's branch name.
		// Uses the owner's saved branchName if set; otherwise derives it from the title and saves it
		// so all subsequent subtasks in the same story see the same branch name.
		let sharedBranchName: string | undefined;
		if (hasSharedWorktree) {
			const ownerCard = board.cards[effectiveWorktreeId];
			if (ownerCard) {
				if (ownerCard.branchName) {
					sharedBranchName = ownerCard.branchName;
				} else {
					sharedBranchName = titleToBranch(ownerCard.description?.split("\n")[0]?.slice(0, 72) ?? ownerCard.id);
					await updateCard(workspaceId, effectiveWorktreeId, { branchName: sharedBranchName });
					logger.info(`[scheduler] Derived and saved shared branch name: ${sharedBranchName}`);
				}
			}
		}

		// Create or reuse the worktree.
		// Shared-worktree cards use the owner's directory (the resolved dependsOn chain root / story).
		// Classic single cards get their own directory. No merge/multi-dep logic.
		let worktree: ReturnType<typeof createWorktree>;
		try {
			worktree = createWorktree(
				effectiveWorktreeId,
				repoPath,
				card.baseRef,
				hasSharedWorktree ? sharedBranchName : card.branchName,
			);
		} catch (err) {
			logger.error(
				`[scheduler] Failed to create worktree for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}": ${String(err)}`,
			);
			if (hasSharedWorktree) this.runningSharedWorktrees.delete(effectiveWorktreeId);
			await moveCard(workspaceId, taskId, "blocked");
			await appendActivityLog(workspaceId, taskId, `Failed to create worktree: ${String(err)}`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}

		// Move card + set worktree path and actual branch name.
		// Always sync branchName in case createWorktree resolved a collision and picked a unique name.
		await updateCard(workspaceId, taskId, { worktreePath: worktree.path, branchName: worktree.branch });
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

			// Plan phase: if the workflow has an enabled plan slot, run it once (unless a
			// plan already exists and the slot's rerun flag is off) before dev. The plan
			// agent saves card.plan via MCP; reload so the dev prompt picks it up.
			const planSlot = cardWorkflow?.slots.find((s) => s.type === "plan" && s.enabled);
			if (planSlot && (!card.plan || planSlot.rerun)) {
				logger.info(`[scheduler] task ${taskId}: starting plan phase`);
				await runPlanPhase(card, planSlot, {
					workspaceId,
					repoPath,
					serverUrl: this.options.serverUrl,
					mcpBinary: getMcpServerPath(),
					worktreePath: worktree.path,
					stateHub,
					secrets,
					systemPrompt: projectConfig.systemPrompt,
					registerStopCallback: this.registerStopCallback.bind(this),
					registerLiveProcess: this.registerLiveProcess.bind(this),
					isManuallyStopped: () => this.planPhaseManuallyStopped.has(taskId),
				});
				if (this.planPhaseManuallyStopped.has(taskId)) {
					this.planPhaseManuallyStopped.delete(taskId);
					logger.info(`[scheduler] task ${taskId}: plan phase was manually stopped — aborting dev launch`);
					return;
				}
				logger.info(`[scheduler] task ${taskId}: plan phase done — proceeding to dev`);
				card = (await loadBoard(workspaceId)).cards[taskId] ?? card;
			}

			const devSystemPromptResult = buildDevAgentSystemPrompt(
				devSlotEarly,
				card,
				resolvePromptText(devSlotEarly.prompt, repoPath),
				worktree.path,
				secrets,
				parentCards,
				projectConfig.systemPrompt,
				projectConfig.gitInstructions,
				projectConfig.autoCommit ?? true,
				undefined, // effectiveBaseRef: no longer needed — shared worktrees use card.baseRef
				siblingCards,
			);
			// Prepend durable memory so the dev agent doesn't re-discover known facts.
			const memContext = buildMemoryContext(workspaceId);
			if (memContext) devSystemPromptResult.text = `${memContext}\n\n${devSystemPromptResult.text}`;
			const secretsEnv = buildSecretsEnv(secrets);

			if (agentId === "claude") {
				await writeClaudeMcpConfig(
					getMcpServerPath(),
					this.options.serverUrl,
					workspaceId,
					agentId,
					mcpConfigPath!,
				).catch(() => {});
			} else if (isPluginConfigAgent(agentId)) {
				const mcpSpec = buildWhippedMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId, agentId);
				await writePluginAgentFiles(agentId, taskId, getServerPort(this.options.serverUrl), mcpSpec, {
					appendSystemPrompt: devSystemPromptResult.text,
				}).catch(() => {});
			} else if (agentId === "cursor") {
				const mcpSpec = buildWhippedMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId, agentId);
				await writeCursorConfigFiles(taskId, getServerPort(this.options.serverUrl), mcpSpec).catch(() => {});
			}

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
				worktreeOwnerId: hasSharedWorktree ? effectiveWorktreeId : undefined,
				process: spawnAgent({
					agentId,
					prompt,
					cwd: worktree.path,
					env: {
						...buildTaskHookEnv(taskId, workspaceId),
						...secretsEnv,
						WHIPPED_SLOT: "dev",
						...(devPair.model ? { WHIPPED_MODEL: devPair.model } : {}),
						...pluginAgentConfigDirEnv(agentId, taskId),
						...(agentId === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(taskId) } : {}),
					},
					hookSettingsPath: agentId === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
					hookServerPort: agentId === "codex" ? getServerPort(this.options.serverUrl) : undefined,
					mcpConfigPath: agentId === "claude" ? mcpConfigPath : undefined,
					mcpServer:
						agentId === "codex"
							? buildWhippedMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId, agentId)
							: undefined,
					appendSystemPrompt: isPluginConfigAgent(agentId)
						? undefined
						: agentId === "cursor"
							? devSystemPromptResult.text +
								"\n\n4. Call the `task_complete` MCP tool to signal that the task is complete."
							: devSystemPromptResult.text,
					files: agentId === "claude" ? devSystemPromptResult.files : undefined,
					effort: devPair.effort ?? undefined,
					model: devPair.model ?? undefined,
					onOutput: (data) => {
						runningTask.outputBuffer += data;
						stateHub.broadcastTerminalOutput(workspaceId, devStreamId, data);
					},
					onExit: async (exitCode) => {
						logger.info(
							`[scheduler] onExit: task ${taskId} agent=${agentId} exitCode=${exitCode} hookHandled=${this.hookHandledTasks.has(taskId)} manuallyStopped=${this.manuallyStoppedTasks.has(taskId)}`,
						);
						this.setRecentBuffer(devStreamId, runningTask.outputBuffer);
						void saveTerminalBuffer(workspaceId, devStreamId, runningTask.outputBuffer);
						this.running.delete(taskId);
						if (runningTask.worktreeOwnerId) this.runningSharedWorktrees.delete(runningTask.worktreeOwnerId);
						if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
						if (isPluginConfigAgent(agentId)) void cleanupPluginAgentFiles(agentId, taskId);
						if (agentId === "cursor") void cleanupCursorConfigDir(taskId);

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
							logger.info(`[scheduler] onExit hookHandled path: ending session ${devStreamId} for task ${taskId}`);
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
							logger.info(`[scheduler] onExit hookHandled: endTerminalSession done for ${devStreamId}`);
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
								id: generateTaskId(),
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
							const hasReviewSlots = (cardWorkflow?.slots ?? []).some(
								(s) => (s.type === "review" || s.type === "orch") && s.enabled,
							);
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
			logger.info(`[scheduler] stopTask: dev agent running — stopping task ${taskId}`);
			this.manuallyStoppedTasks.add(taskId);
			this.manuallyStoppedForHook.add(taskId);
			task.process.kill();
			this.running.delete(taskId);
			void appendActivityLog(this.options.workspaceId, taskId, "Agent stopped manually");
		} else {
			// No dev agent yet (e.g. still in plan phase) — move the card to todo now.
			logger.info(`[scheduler] stopTask: no dev agent running for ${taskId} — moving to todo immediately`);
			this.planPhaseManuallyStopped.add(taskId);
			const { workspaceId, stateHub } = this.options;
			void (async () => {
				const board = await loadBoard(workspaceId);
				const card = board.cards[taskId];
				logger.info(`[scheduler] stopTask (plan phase): card ${taskId} columnId=${card?.columnId}`);
				if (card?.columnId === "in_progress" || card?.columnId === "ready_for_review") {
					await moveCard(workspaceId, taskId, "todo");
					await updateCard(workspaceId, taskId, { readyForDev: false });
					await appendActivityLog(workspaceId, taskId, "Moved back to Todo");
					stateHub.broadcastWorkspaceUpdate(workspaceId);
					logger.info(`[scheduler] stopTask (plan phase): moved ${taskId} to todo`);
				}
				// Release the isHandlingTask guard so the poller doesn't block legitimate restarts.
				this.planPhaseManuallyStopped.delete(taskId);
			})();
		}
		this.stopReviewAgentsForCard(taskId);
	}

	// Fire stop callbacks for any review-pipeline agents whose streamId belongs
	// to this card. Without this, deleting a card while reviews are still
	// running leaves orphan agents that finish in a deleted worktree and crash
	// the post-review push.
	private stopReviewAgentsForCard(cardId: string): void {
		const prefix = `${cardId}-`;
		for (const streamId of [...this.stopCallbacks.keys()]) {
			if (!streamId.startsWith(prefix)) continue;
			const cb = this.stopCallbacks.get(streamId);
			if (!cb) continue;
			this.stopCallbacks.delete(streamId);
			this.manuallyStoppedStreams.add(streamId);
			logger.info(`[scheduler] Stopping review agent ${streamId} (card ${cardId} stopped)`);
			try {
				cb();
			} catch (err) {
				logger.warn({ err }, `[scheduler] stopReviewAgentsForCard: callback for ${streamId} threw`);
			}
		}
	}

	// One-shot check: returns true and removes the entry if this stream was manually stopped.
	isStreamManuallyStopped(streamId: string): boolean {
		return this.manuallyStoppedStreams.delete(streamId);
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
			`[scheduler] triggerParentReopenCascade: ${childCards.length} children for parent "${parentCard.description?.split("\n")[0]?.slice(0, 60) ?? parentCard.id}"`,
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
			isStreamManuallyStopped: this.isStreamManuallyStopped.bind(this),
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
		// Assistant agent sessions use taskId as their streamId
		const assistantSession = this.assistantSessions.get(streamId);
		if (assistantSession) return assistantSession.outputBuffer;
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
		return this.assistantSessions.get(streamId)?.process ?? this.liveProcesses.get(streamId);
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
			if (!card) return;

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
				if (card.columnId === "in_progress") {
					await moveCard(workspaceId, taskId, "todo");
					await updateCard(workspaceId, taskId, { readyForDev: false });
					await appendActivityLog(workspaceId, taskId, "Moved back to Todo");
				}
				stateHub.broadcastWorkspaceUpdate(workspaceId);
				logger.info(`[scheduler] Hook Stop (manual): task ${taskId} → todo`);
				return;
			}

			// Always kill the process and end the terminal session immediately.
			// Do NOT rely on onExit to call endTerminalSession — some agents (e.g. opencode TUI)
			// don't exit after SIGTERM, so pty.onExit never fires.
			this.hookHandledTasks.add(taskId);
			const task = this.running.get(taskId);
			logger.info(`[scheduler] Hook Stop: task ${taskId} — running task found=${!!task} cardColumn=${card.columnId}`);
			if (task) {
				this.setRecentBuffer(task.streamId, task.outputBuffer);
				void saveTerminalBuffer(workspaceId, task.streamId, task.outputBuffer);
				task.process.kill();
				this.running.delete(taskId);
				logger.info(`[scheduler] Hook Stop: task ${taskId} process killed (pid via treeKill)`);
				// End the session now — don't wait for pty.onExit which may never fire.
				const hookBoard = await loadBoard(workspaceId);
				const hookCard = hookBoard.cards[taskId];
				// Only match a dev comment from THIS run (createdAt >= task.startedAt).
				// Without this guard, re-runs reuse the old comment and never record a new one.
				const hookDevComment = hookCard?.reviewComments
					?.slice()
					.reverse()
					.find((c) => c.type === "dev" && c.createdAt >= task.startedAt);
				if (hookDevComment) {
					await linkCommentToSession(workspaceId, taskId, hookDevComment.createdAt, task.streamId);
				} else {
					// Dev agent didn't call kanban_add_comment — add a fallback so the review
					// pipeline and UI always have a comment to work with.
					const parsed = tryParseAgentJson(task.outputBuffer);
					const fallback: import("../core/api-contract.js").RuntimeReviewComment = {
						id: generateTaskId(),
						type: "dev",
						actor: { type: "ai", id: task.agentId },
						status: "pass",
						createdAt: Date.now(),
						streamId: task.streamId,
						summary: parsed?.summary ?? "Agent completed.",
						issues: parsed?.issues,
						metadata: parsed?.metadata,
					};
					const existingComments = hookCard?.reviewComments ?? [];
					await updateCard(workspaceId, taskId, { reviewComments: [...existingComments, fallback] });
					logger.info(`[scheduler] Hook Stop: added fallback dev comment for task ${taskId}`);
				}
				await endTerminalSession(workspaceId, taskId, task.streamId, Date.now(), "completed");
				logger.info(`[scheduler] Hook Stop: endTerminalSession done for ${task.streamId}`);
			}

			if (card.columnId === "in_progress") {
				if (card.pr?.url) {
					const worktreePath = getWorktreePath(resolveWorktreeOwnerId(taskId, board.cards));
					const taskBranch = getCardBranch(card);
					const hookConfig2 = await loadProjectConfig(workspaceId);
					if (!hookConfig2.autoCommit) {
						const commitMsg = card.pr?.title ?? card.description?.split("\n")[0]?.slice(0, 72) ?? card.id;
						await commitIfDirty(worktreePath, commitMsg).catch((err) =>
							logger.warn(`[scheduler] commitIfDirty before push failed for ${taskId}: ${String(err)}`),
						);
					}
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
				const hookHasReview = (hookWorkflow?.slots ?? []).some(
					(s) => (s.type === "review" || s.type === "orch") && s.enabled,
				);
				if (!hookHasReview) {
					await moveCard(workspaceId, taskId, "ready_for_review");
					await appendActivityLog(workspaceId, taskId, "Agent finished → moved to Ready for Review");
				} else {
					await appendActivityLog(workspaceId, taskId, "Agent finished → AI review starting");
				}
				logger.info(
					`[scheduler] Hook Stop: task ${taskId} → ${hookHasReview ? "in_progress (review pending)" : "ready_for_review"}`,
				);
				this.options.onTaskCompleted(taskId);
			} else {
				// Card was already moved by the agent (e.g. via kanban_move_card MCP).
				// Still trigger review in case it hasn't started yet.
				logger.info(`[scheduler] Hook Stop: task ${taskId} already in ${card.columnId} — skipping card transition`);
				this.options.onTaskCompleted(taskId);
			}
			stateHub.broadcastWorkspaceUpdate(workspaceId);
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

		const conflictProjectConfig = await loadProjectConfig(workspaceId);
		const conflictGitInstructions = conflictProjectConfig.gitInstructions?.trim() || DEFAULT_GIT_INSTRUCTIONS;

		let outputBuffer = "";
		let hookHandled = false;

		const conflictSystemPrompt = buildConflictResolutionSystemPrompt(card, conflictedFiles, conflictGitInstructions);

		if (isPluginConfigAgent(defaultAgent)) {
			const mcpSpec = buildWhippedMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId);
			await writePluginAgentFiles(defaultAgent, streamId, getServerPort(this.options.serverUrl), mcpSpec, {
				appendSystemPrompt: conflictSystemPrompt,
			}).catch(() => {});
		} else if (defaultAgent === "cursor") {
			const mcpSpec = buildWhippedMcpServerSpec(getMcpServerPath(), this.options.serverUrl, workspaceId);
			await writeCursorConfigFiles(streamId, getServerPort(this.options.serverUrl), mcpSpec).catch(() => {});
		}

		const proc = spawnAgent({
			agentId: defaultAgent,
			prompt: buildTaskPrompt(),
			cwd: mergeWorktreePath,
			hookSettingsPath: defaultAgent === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
			hookServerPort: defaultAgent === "codex" ? getServerPort(this.options.serverUrl) : undefined,
			env: {
				...buildTaskHookEnv(streamId, workspaceId),
				...pluginAgentConfigDirEnv(defaultAgent, streamId),
				...(defaultAgent === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(streamId) } : {}),
			},
			appendSystemPrompt: isPluginConfigAgent(defaultAgent) ? undefined : conflictSystemPrompt,
			onOutput: (data) => {
				outputBuffer += data;
				stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
			},
			onExit: async (exitCode) => {
				this.liveProcesses.delete(streamId);
				this.setRecentBuffer(streamId, outputBuffer);
				void saveTerminalBuffer(workspaceId, streamId, outputBuffer);
				if (defaultAgent === "cursor") void cleanupCursorConfigDir(streamId);
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
			if (isPluginConfigAgent(defaultAgent)) void cleanupPluginAgentFiles(defaultAgent, streamId);
			if (defaultAgent === "cursor") void cleanupCursorConfigDir(streamId);
			proc.kill();
			onComplete(true).catch((err) => logger.error({ err }, `[scheduler] conflict onComplete failed for ${card.id}:`));
		});
	}

	stopAll(): void {
		for (const [taskId] of this.running) {
			this.stopTask(taskId);
		}
		this.stopAssistantAgent();
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

function buildAssistantAgentSystemPrompt(
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
- When you create a task or subtask card, set \`readyForDev: true\` by default so the dev agent picks it up — unless the developer asks to leave it as a draft or not start it yet

# Available MCP Tools

## Board
- \`kanban_get_board\` — fetch the live board state (cards, columns, current status)
- \`kanban_create_card\` — create a single task card (type: "task" by default; also accepts "story" or "subtask")
- \`kanban_create_story\` — create a story with all its subtasks in one call (preferred for stories)
- \`kanban_move_card\` — move a card to a different column
- \`kanban_update_card\` — update a card's description, priority, dependencies, or model level
- \`kanban_delete_card\` — delete a card
- \`kanban_add_comment\` — record a comment on a card

## Workflows
- \`kanban_get_workflows\` — list all workflows (task and story/orch) with their agent slots, model tiers, tools, and prompts
- \`kanban_upsert_workflow\` — create or fully replace a workflow (pass complete workflow object)

## Memory
- \`whipped_search_memory\` — search durable project + global memory before re-discovering how something works
- \`whipped_get_memory\` — fetch one memory's full content by id
- \`whipped_save_memory\` — record a durable fact (convention, decision, preference, gotcha, or user correction)
- \`whipped_update_memory\` — correct an existing memory by id when it's now wrong; prefer this over saving a near-duplicate

The Memory section injected above this prompt lists existing memories with their \`[id]\`. When the developer asks you to "remember" something, or states a durable preference/decision, save it. Before saving, check the injected list and \`whipped_search_memory\`; if it contradicts or supersedes an existing entry, \`whipped_update_memory\` that id instead of creating a duplicate.

# Card types

**task** — a normal development ticket. Runs an optional plan slot, then dev, then any number of review slots (based on workflow).

**story** — an epic with child subtasks. After ALL subtasks complete, the story runs its orchestrator (orch) workflow which reviews the whole picture and may reopen subtasks. Use \`kanban_create_story\` to create one atomically.

**subtask** — a child of a story. Runs its own full dev workflow. Created automatically by \`kanban_create_story\`, or manually via \`kanban_create_card\` with type: "subtask". Always set readyForDev: true.

# Attachments

When you attach files or images to a card (the \`attachments\` parameter of \`kanban_create_card\` / \`kanban_create_story\` / \`kanban_update_card\`), don't attach them silently — **reference each one inline in the description with an \`[Attachment #N]\` token** so the downstream dev and review agents know which file applies where.

- \`N\` is 1-based and must match the file's position in the \`attachments\` array you pass: first file → \`[Attachment #1]\`, second → \`[Attachment #2]\`, and so on. Keep the numbering contiguous.
- Put each token at the point in the text where that file is relevant, e.g. "Match the layout in [Attachment #1] and use the palette from [Attachment #2]." or "Reproduce the crash shown in [Attachment #1]."
- Only reference attachments you are actually passing, and pass every attachment you reference.

# Branch names

When creating a **task** or **subtask** card, always set \`branchName\` to a suitable value derived from the title. Story cards themselves do not take a branchName (only their subtasks do).

Format: \`<type>/<slug>\` — all lowercase, dashes between words (never underscores), slug ≤ 60 chars.

Pick the type prefix from the work intent:
- \`feat/\` — new feature or capability (default if unsure)
- \`fix/\` — bug fix or hotfix
- \`refactor/\` — restructure without behavior change (renames, moves, reworks)
- \`chore/\` — upgrades, dependency bumps, cleanup, tooling
- \`test/\` — test-only changes
- \`docs/\` — documentation only
- \`style/\` — formatting, lint, whitespace only

Examples:
- "Fix user auth bug" → \`fix/user-auth-bug\`
- "Add dark mode toggle" → \`feat/dark-mode-toggle\`
- "Upgrade React to 19" → \`chore/upgrade-react-to-19\`
- "Rename UserService to AccountService" → \`refactor/rename-user-service\`

# Model level

Each card runs at one capability **level** (\`minimal\` → \`low\` → \`medium\` → \`high\` → \`max\`). The level is workflow-wide: every slot (plan, dev, review/orch) maps it to its own model via that slot's tiers + mode. The \`activeLevel\` parameter on \`kanban_create_card\` / \`kanban_create_story\` (and per-subtask) sets it; omit it to default to the workflow's highest configured tier. Match the level to the work — lower it for trivial/mechanical tickets to save cost, keep it high for complex or risky changes. Use \`kanban_update_card\` to change a card's level later.

# Choosing a workflow for a card

\`workflowId\` is **required** when creating a card (\`kanban_create_card\`, \`kanban_create_story\`, and each subtask). Before creating, call \`kanban_get_workflows\` and pick the workflow whose name/purpose best fits the task — e.g. a frontend/UI workflow for UI-only work, a backend/API workflow for server work. Only fall back to the default workflow when none is a good fit. Task cards use task workflows; stories use story (orch) workflows.

# Workflow guidance

When asked to suggest or create a workflow:
1. Call \`kanban_get_board\` to understand the project type and existing tasks
2. Call \`kanban_get_workflows\` to see what already exists — note that task and story workflows are separate
3. Suggest appropriate agent slots and write focused, specific prompts for each slot
4. Use \`kanban_upsert_workflow\` to save
   - Task workflows: always include a dev slot (type: "dev"). Optionally add a plan slot (type: "plan", runs once before dev) and any number of review slots (type: "review") — chain them via \`order\`, and grant a review slot the "browser" tool for QA-style checks.
   - Story workflows: use only orch slots (type: "orch"). Set forStory: true.
   - Each slot carries model tiers: a priority-ordered list of pairs (first = highest priority), each tagged with a capability level (minimal→max) and isFree flag. A card has one workflow-wide active level; per slot a \`mode\` (auto / preferFree / freeOnly / paidOnly) picks which pair runs at that level. There is no per-slot default pair — order + level + mode decide it. Review slots may set \`canAdjustLevel\` so they can right-size the card's active level on reopen.

Slot prompts should be specific to the project's domain and the slot's role.${secretsSection ? `\n\n${secretsSection}` : ""}${systemPrompt?.trim() ? `\n\n## Project context\n\n${systemPrompt.trim()}` : ""}`;
}

function buildConflictResolutionSystemPrompt(
	card: RuntimeBoardCard,
	conflictedFiles: string[],
	gitInstructions: string,
): string {
	return `You are a merge conflict resolution agent. Your only job is to resolve git merge conflicts.

Rules:
- Only edit files to remove conflict markers (<<<<<<< ======= >>>>>>>)
- Preserve the intent of BOTH sides where possible; when in doubt keep the incoming (task) changes
- Never refactor, rename, or change logic beyond resolving the conflict markers
- Exit when done

## Task being merged

${card.description?.trim() ?? ""}

## Conflicted files

${conflictedFiles.map((f) => `- ${f}`).join("\n")}

Resolve each conflict, preserving the task's intent. Then stage and commit the resolution. Write the commit message following the project's git conventions below — do not use a hard-coded template.

## Git conventions

${gitInstructions}`;
}

function buildTaskPrompt(): string {
	return "Start";
}
