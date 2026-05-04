import * as nodePty from "node-pty";
import treeKill from "tree-kill";
import type { RuntimeAgentId } from "../core/api-contract.js";
import { buildAgentArgs, getAgentCommand } from "./agent-registry.js";

export interface AgentRunOptions {
	agentId: RuntimeAgentId;
	prompt: string;
	cwd: string;
	env?: Record<string, string>;
	hookSettingsPath?: string;
	mcpConfigPath?: string;
	mode?: "interactive" | "print";
	onOutput: (data: string) => void;
	onExit: (exitCode: number) => void;
}

export interface AgentProcess {
	kill: () => void;
	resize: (cols: number, rows: number) => void;
	write: (data: string) => void;
}

export function spawnAgent(options: AgentRunOptions): AgentProcess {
	const { agentId, prompt, cwd, env, hookSettingsPath, mcpConfigPath, mode = "interactive", onOutput, onExit } = options;

	const command = getAgentCommand(agentId);
	const args = buildAgentArgs(agentId, prompt, mode);
	if (hookSettingsPath && agentId === "claude") {
		args.push("--settings", hookSettingsPath);
	}
	if (mcpConfigPath && agentId === "claude") {
		args.push("--mcp-config", mcpConfigPath);
	}

	const pty = nodePty.spawn(command, args, {
		name: "xterm-color",
		cols: 220,
		rows: 50,
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
			treeKill(pty.pid);
		},
		resize(cols, rows) {
			pty.resize(cols, rows);
		},
		write(data) {
			pty.write(data);
		},
	};
}
