import { unlink } from "node:fs/promises";
import {
	buildMcpRoleArgs,
	buildTaskHookEnv,
	buildWhippedMcpServerSpec,
	CLAUDE_TASK_SETTINGS_PATH,
	cleanupCursorConfigDir,
	cleanupPluginAgentFiles,
	CURSOR_CONFIG_DIR_ENV,
	getCursorConfigDir,
	getMcpConfigPath,
	getServerPort,
	isPluginConfigAgent,
	pluginAgentConfigDirEnv,
	writeClaudeMcpConfig,
	writeCursorConfigFiles,
	writePluginAgentFiles,
} from "../agents/agent-hooks.js";
import type { AgentProcess } from "../agents/agent-runner.js";
import { spawnAgent } from "../agents/agent-runner.js";
import type {
	RecurringAgent,
	RecurringRunStatus,
	RecurringRunTrigger,
	RuntimeProjectSecret,
} from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	finishRecurringRun,
	getDueRecurringAgents,
	getRecurringAgent,
	markRecurringRan,
	startRecurringRun,
} from "../state/recurring-agents-store.js";
import { buildMemoryContext } from "../state/memory-store.js";
import { loadProjectConfig } from "../state/workspace-state.js";
import { saveTerminalBuffer } from "../state/workspace-state.js";
import { getMcpServerPath } from "./scheduler.js";
import { buildSecretsEnv, buildSecretsSection } from "./review-pipeline.js";

// How often the loop wakes to look for due agents. Schedules carry their own
// precise next_run_at; this only bounds how late a run can start.
const RECURRING_TICK_SECONDS = 30;
// Cost guardrail: cap concurrent recurring runs so a slow sweep can't fan out.
const MAX_CONCURRENT_RECURRING = 2;
// Keep only the tail of the transcript as the run summary; the full output lives
// in the terminal buffer (replayable from the detail view).
const SUMMARY_TAIL_CHARS = 240;

export interface RecurringAgentSchedulerOptions {
	workspaceId: string;
	repoPath: string;
	serverUrl: string;
	stateHub: RuntimeStateHub;
	// Recurring agents run as interactive sessions (like dev/review agents); the
	// Stop hook signals completion. These come from the TaskScheduler so the shared
	// /api/hook route resolves a recurring run by its streamId.
	registerStopCallback: (streamId: string, callback: () => void) => () => void;
	registerLiveProcess: (streamId: string, process: AgentProcess) => () => void;
}

export class RecurringAgentScheduler {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = new Set<string>();
	// Live agent processes by streamId, so a restart/shutdown can kill them.
	private liveProcs = new Map<string, AgentProcess>();
	private stopped = false;

	constructor(private options: RecurringAgentSchedulerOptions) {}

	start(): void {
		this.stopped = false;
		this.scheduleTick();
	}

	stop(): void {
		this.stopped = true;
		// Kill any in-flight observer agents — pending sessions don't survive a restart.
		for (const proc of this.liveProcs.values()) {
			try {
				proc.kill();
			} catch {
				/* already gone */
			}
		}
		this.liveProcs.clear();
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	private scheduleTick(): void {
		this.timer = setTimeout(() => void this.tick(), RECURRING_TICK_SECONDS * 1000);
	}

	private async tick(): Promise<void> {
		try {
			const due = getDueRecurringAgents(this.options.workspaceId, Date.now());
			for (const agent of due) {
				if (this.running.size >= MAX_CONCURRENT_RECURRING) break;
				if (this.running.has(agent.id)) continue;
				void this.runAgent(agent, "schedule");
			}
		} catch (err) {
			logger.error({ err }, "[recurring] tick failed");
		}
		if (!this.stopped) this.scheduleTick();
	}

	// Manual "Run now" — ignores the schedule but does not advance it.
	async runNow(recurringAgentId: string): Promise<boolean> {
		const agent = getRecurringAgent(recurringAgentId);
		if (!agent) return false;
		if (this.running.has(agent.id)) return false;
		void this.runAgent(agent, "manual");
		return true;
	}

	private async runAgent(agent: RecurringAgent, trigger: RecurringRunTrigger): Promise<void> {
		const { workspaceId, repoPath, serverUrl, stateHub } = this.options;
		this.running.add(agent.id);

		// Advance the schedule up front (only for scheduled runs) so a long run can't
		// double-fire on the next tick. Manual runs leave the schedule untouched.
		if (trigger === "schedule") markRecurringRan(agent.id);

		const streamId = `recurring-${agent.id}-${Date.now()}`;
		const runId = startRecurringRun(agent.id, workspaceId, trigger, streamId);
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		const agentBinary = agent.model.agentId;
		const mcpConfigPath = agentBinary === "claude" ? getMcpConfigPath(streamId) : undefined;
		const roleArgs = buildMcpRoleArgs("recurring", agent.id);
		const mcpServer = buildWhippedMcpServerSpec(getMcpServerPath(), serverUrl, workspaceId, agentBinary, roleArgs);
		const hookServerPort = getServerPort(serverUrl);

		let projectSystemPrompt: string | undefined;
		let secrets: RuntimeProjectSecret[] = [];
		let secretsEnv: Record<string, string> = {};
		try {
			const projectConfig = await loadProjectConfig(workspaceId);
			projectSystemPrompt = projectConfig.systemPrompt;
			secrets = projectConfig.secrets ?? [];
			secretsEnv = buildSecretsEnv(secrets);
		} catch (err) {
			logger.warn({ err, agentId: agent.id }, "[recurring] failed to load project config");
		}

		const baseSystemPrompt = buildRecurringSystemPrompt(
			repoPath,
			agent.name,
			agent.instructions,
			agent.journal,
			secrets,
			projectSystemPrompt,
		);
		// Inject persistent memory like dev/assistant agents, read-only: observers
		// can recall memory but cannot save or update it.
		const memContext = buildMemoryContext(workspaceId, 40, { readOnly: true });
		const appendSystemPrompt = memContext ? `${memContext}\n\n${baseSystemPrompt}` : baseSystemPrompt;
		const prompt = buildRecurringPrompt();

		if (agentBinary === "claude" && mcpConfigPath) {
			await writeClaudeMcpConfig(
				getMcpServerPath(),
				serverUrl,
				workspaceId,
				agentBinary,
				mcpConfigPath,
				undefined,
				roleArgs,
			).catch((err) => logger.warn({ err }, "[recurring] failed to write claude MCP config"));
		} else if (isPluginConfigAgent(agentBinary)) {
			await writePluginAgentFiles(agentBinary, streamId, hookServerPort, mcpServer, {
				appendSystemPrompt,
				readOnly: true,
			}).catch((err) => logger.warn({ err }, `[recurring] failed to write ${agentBinary} files`));
		} else if (agentBinary === "cursor") {
			await writeCursorConfigFiles(streamId, hookServerPort, mcpServer).catch((err) =>
				logger.warn({ err }, "[recurring] failed to write cursor config"),
			);
		}

		logger.info(`[recurring:${agent.id}] starting ${trigger} run as ${agentBinary} (${agent.name})`);

		let output = "";
		let settled = false;
		let unregisterStop: (() => void) | undefined;
		let unregisterProcess: (() => void) | undefined;

		const cleanup = (): void => {
			if (mcpConfigPath) unlink(mcpConfigPath).catch(() => {});
			if (isPluginConfigAgent(agentBinary)) void cleanupPluginAgentFiles(agentBinary, streamId);
			if (agentBinary === "cursor") void cleanupCursorConfigDir(streamId);
		};

		// Idempotent — the Stop hook and the process exit can both fire.
		const finish = (status: RecurringRunStatus): void => {
			if (settled) return;
			settled = true;
			unregisterStop?.();
			unregisterProcess?.();
			this.liveProcs.delete(streamId);
			void saveTerminalBuffer(workspaceId, streamId, output);
			cleanup();
			// During shutdown the DB is closing and startup will mark this run "killed",
			// so skip the DB write / broadcast here.
			if (!this.stopped) {
				const summary = output.trim().slice(-SUMMARY_TAIL_CHARS) || undefined;
				finishRecurringRun(runId, { status, summary });
				this.running.delete(agent.id);
				stateHub.broadcastWorkspaceUpdate(workspaceId);
			}
			logger.info(`[recurring:${agent.id}] run ${status}`);
		};

		try {
			// Interactive agents stay alive after finishing their turn — the Stop hook
			// (claude/cursor settings, codex inline) is what signals completion, so we
			// kill the process and finalise from the callback.
			unregisterStop = this.options.registerStopCallback(streamId, () => {
				proc.kill();
				finish("ok");
			});

			const proc = spawnAgent({
				agentId: agentBinary,
				prompt,
				cwd: repoPath,
				mode: "interactive",
				env: {
					...secretsEnv,
					...buildTaskHookEnv(streamId, workspaceId),
					WHIPPED_SLOT: "recurring",
					...(agent.model.model ? { WHIPPED_MODEL: agent.model.model } : {}),
					...pluginAgentConfigDirEnv(agentBinary, streamId),
					...(agentBinary === "cursor" ? { [CURSOR_CONFIG_DIR_ENV]: getCursorConfigDir(streamId) } : {}),
				},
				hookSettingsPath: agentBinary === "claude" ? CLAUDE_TASK_SETTINGS_PATH : undefined,
				hookServerPort: agentBinary === "codex" ? hookServerPort : undefined,
				mcpConfigPath,
				mcpServer: agentBinary === "codex" ? mcpServer : undefined,
				appendSystemPrompt: isPluginConfigAgent(agentBinary) ? undefined : appendSystemPrompt,
				model: agent.model.model,
				effort: agent.model.effort,
				// Observer agents are read-only: claude blocks file/shell tools via
				// --disallowedTools, opencode/mimo disable them in their config. codex/cursor
				// fall back to prompt-only enforcement.
				readOnly: true,
				onOutput: (data) => {
					output += data;
					stateHub.broadcastTerminalOutput(workspaceId, streamId, data);
				},
				onExit: (exitCode) => finish(exitCode === 0 ? "ok" : "error"),
			});

			this.liveProcs.set(streamId, proc);
			unregisterProcess = this.options.registerLiveProcess(streamId, proc);
		} catch (err) {
			logger.error({ err, agentId: agent.id }, "[recurring] spawn failed");
			finish("error");
		}
	}
}

function buildRecurringPrompt(): string {
	return "Begin now. When you're done, update your journal and end the run.";
}

function buildRecurringSystemPrompt(
	repoPath: string,
	agentName: string,
	instructions: string,
	journal: string,
	secrets: RuntimeProjectSecret[],
	projectSystemPrompt?: string,
): string {
	const task = instructions.trim() || "Run your scheduled checks and report any findings.";
	const journalBlock = journal.trim() || "(empty — this is your first run)";
	let prompt = `You are a recurring **observer** agent named "${agentName}" for the project at \`${repoPath}\`, running on a schedule. You run once now, then exit.

## Your task
${task}

## Code Writing Policy

**NEVER write, edit, or create source code files directly, and never run shell commands that modify anything.** You are a read-only observer — your job is to inspect the project, watch the board, and report findings on the Kanban board.

If your task implies implementing something, adding a feature, fixing a bug, or making any code change:
1. Create a task card with clear requirements (\`kanban_create_card\`)
2. Let the dev agent handle the implementation

Never make the change yourself. A needed code change is a finding to *report*, never a thing you do. Do not use Edit/Write/Patch or write via Bash — those tools are also withheld at the system level, so attempting them only wastes the run.

## What to do each run
- Inspect the repo read-only (Read/Grep/Glob) and the board (\`kanban_get_board\`).
- Carry out your task's instructions as an *observation*, then report anything worth acting on.

## How to report
- File findings as normal backlog cards with \`kanban_create_card\` (leave the column/status at default — never mark anything done or in-progress), or add a \`kanban_add_comment\` to an existing card.
- \`kanban_create_card\` requires a \`workflowId\` and a \`branchName\`: call \`kanban_get_workflows\` and pick the workflow matching the finding's area (frontend/backend/etc., else the default), and derive a \`<type>/<slug>\` branch name from the title.
- Set \`readyForDev: true\` on cards you file so the dev agent picks them up automatically — unless your task instructions above say to leave them for manual review.
- Never file the same issue twice — check your journal and the existing board first.
- You also cannot move, update, delete, or complete cards (those tools are withheld).

## Your journal (memory from previous runs)
This is what you recorded last time — use it to avoid repeating work or filing duplicate cards:

${journalBlock}

When you finish, call \`update_journal\` with the full updated notes to keep for next time (what you checked, what you filed, what you're watching). It REPLACES the journal, so include everything still relevant.

If your task is a one-off that is now complete, or the condition you were watching for is resolved and there is nothing left to do on future runs, call \`disable_self\` to stop running on schedule. This only pauses future runs (the user can re-enable you); the current run still finishes normally. Update your journal before disabling.

## Available tools
\`kanban_get_board\`, \`kanban_create_card\`, \`kanban_add_comment\`, \`kanban_get_workflows\`, \`whipped_search_memory\`, \`whipped_get_memory\`, \`update_journal\`, \`disable_self\`, plus read-only repo tools (Read, Grep, Glob).`;

	const secretsSection = buildSecretsSection(secrets);
	if (secretsSection) prompt += `\n\n${secretsSection}`;
	if (projectSystemPrompt?.trim()) prompt += `\n\n## Project context\n${projectSystemPrompt.trim()}`;
	return prompt;
}
