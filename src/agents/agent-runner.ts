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
	appendSystemPrompt?: string;
	files?: string[];
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
	const { agentId, prompt, cwd, env, hookSettingsPath, mcpConfigPath, appendSystemPrompt, files, mode = "interactive", onOutput, onExit } = options;

	const command = getAgentCommand(agentId);
	const args = buildAgentArgs(agentId, prompt, mode);
	if (hookSettingsPath && agentId === "claude") {
		args.push("--settings", hookSettingsPath);
	}
	if (mcpConfigPath && agentId === "claude") {
		args.push("--mcp-config", mcpConfigPath);
	}
	if (appendSystemPrompt && agentId === "claude") {
		args.push("--append-system-prompt", appendSystemPrompt);
	}
	if (files?.length && agentId === "claude") {
		for (const f of files) {
			args.push("--file", f);
		}
	}

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
			try { treeKill(pty.pid); } catch { /* process may already be gone */ }
		},
		resize(cols, rows) {
			try { pty.resize(cols, rows); } catch { /* PTY may already be closed */ }
		},
		write(data) {
			try { pty.write(data); } catch { /* PTY may already be closed */ }
		},
	};
}
