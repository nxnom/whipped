import * as nodePty from "node-pty";
import treeKill from "tree-kill";
import type { EffortLevel, RuntimeAgentId } from "../core/api-contract.js";
import { buildAgentArgs, getAgentCommand } from "./agent-registry.js";

export interface AgentRunOptions {
	agentId: RuntimeAgentId;
	prompt: string;
	cwd: string;
	env?: Record<string, string>;
	// Hooks (Stop/UserPromptSubmit) for task lifecycle signaling.
	// Claude reads a pre-written settings.json; codex builds the same config inline from the port.
	hookSettingsPath?: string;
	hookServerPort?: number;
	// MCP server registration so the agent can call kanbom_* tools.
	// Claude reads a pre-written JSON; codex inlines the spec.
	mcpConfigPath?: string;
	mcpServer?: { command: string; args: string[] };
	appendSystemPrompt?: string;
	files?: string[];
	mode?: "interactive" | "print";
	effort?: EffortLevel | null;
	model?: string | null;
	onOutput: (data: string) => void;
	onExit: (exitCode: number) => void;
}

export interface AgentProcess {
	kill: () => void;
	resize: (cols: number, rows: number) => void;
	write: (data: string) => void;
}

export function spawnAgent(options: AgentRunOptions): AgentProcess {
	const { agentId, prompt, cwd, env, mode = "interactive", onOutput, onExit } = options;

	const command = getAgentCommand(agentId);
	const args = buildAgentArgs(agentId, prompt, {
		mode,
		hookSettingsPath: options.hookSettingsPath,
		hookServerPort: options.hookServerPort,
		mcpConfigPath: options.mcpConfigPath,
		mcpServer: options.mcpServer,
		appendSystemPrompt: options.appendSystemPrompt,
		files: options.files,
		effort: options.effort,
		model: options.model,
	});

	const pty = nodePty.spawn(command, args, {
		name: "xterm-256color",
		cols: 120,
		rows: 40,
		cwd,
		env: {
			...process.env,
			...env,
			TERM: "xterm-color",
		},
	});

	pty.onData((data) => {
		onOutput(data);
	});

	pty.onExit(({ exitCode }) => {
		onExit(exitCode ?? 0);
	});

	return {
		kill() {
			try {
				treeKill(pty.pid);
			} catch {
				/* process may already be gone */
			}
		},
		resize(cols, rows) {
			try {
				pty.resize(cols, rows);
			} catch {
				/* PTY may already be closed */
			}
		},
		write(data) {
			try {
				pty.write(data);
			} catch {
				/* PTY may already be closed */
			}
		},
	};
}
