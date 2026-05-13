import { spawnSync } from "node:child_process";
import type { EffortLevel, RuntimeAgentId } from "../core/api-contract.js";
import {
	buildCodexDeveloperInstructions,
	buildCodexEffortOverride,
	buildCodexHookOverrides,
	buildCodexMcpOverrides,
} from "./codex-args.js";

export interface AgentInfo {
	id: RuntimeAgentId;
	label: string;
	command: string;
	checkCommand: string[];
}

const AGENT_DEFINITIONS: AgentInfo[] = [
	{
		id: "claude",
		label: "Claude Code",
		command: "claude",
		checkCommand: ["claude", "--version"],
	},
	{
		id: "codex",
		label: "OpenAI Codex",
		command: "codex",
		checkCommand: ["codex", "--version"],
	},
];

function isCommandAvailable(args: string[]): boolean {
	const result = spawnSync(args[0]!, args.slice(1), {
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 5000,
	});
	return result.status === 0 || result.status === null;
}

export function getAvailableAgents(): AgentInfo[] {
	return AGENT_DEFINITIONS.filter((agent) => {
		try {
			return isCommandAvailable(agent.checkCommand);
		} catch {
			return false;
		}
	});
}

export function getAgentCommand(agentId: RuntimeAgentId): string {
	const agent = AGENT_DEFINITIONS.find((a) => a.id === agentId);
	if (!agent) {
		throw new Error(`Unknown agent: ${agentId}`);
	}
	return agent.command;
}

// Agent-agnostic launch context. Claude consumes file paths (settings/mcp);
// codex consumes the same data inlined as `-c` TOML overrides. The caller
// passes whichever of these the runtime has — buildAgentArgs picks the
// right ones for the target agent and ignores the rest.
export interface AgentArgsContext {
	mode?: "interactive" | "print";
	hookSettingsPath?: string;
	hookServerPort?: number;
	mcpConfigPath?: string;
	mcpServer?: { command: string; args: string[] };
	appendSystemPrompt?: string;
	files?: string[];
	effort?: EffortLevel | null;
}

// "interactive": stays alive after finishing (task agents — Stop hook handles completion).
// "print": exits when done (one-shot runs).
export function buildAgentArgs(agentId: RuntimeAgentId, prompt: string, ctx: AgentArgsContext = {}): string[] {
	const mode = ctx.mode ?? "interactive";
	switch (agentId) {
		case "claude": {
			const args: string[] = [];
			if (mode === "print") {
				args.push("-p", prompt, "--dangerously-skip-permissions");
			} else {
				args.push("--dangerously-skip-permissions");
			}
			if (ctx.hookSettingsPath) args.push("--settings", ctx.hookSettingsPath);
			if (ctx.mcpConfigPath) args.push("--mcp-config", ctx.mcpConfigPath);
			if (ctx.appendSystemPrompt) args.push("--append-system-prompt", ctx.appendSystemPrompt);
			if (ctx.files?.length) {
				for (const f of ctx.files) args.push("--file", f);
			}
			if (ctx.effort) args.push("--effort", ctx.effort);
			if (mode === "interactive" && prompt.trim()) args.push(prompt);
			return args;
		}
		case "codex": {
			// `-c` overrides must precede any subcommand (e.g. `exec`).
			const overrides: string[] = [];
			if (ctx.hookServerPort != null) overrides.push(...buildCodexHookOverrides(ctx.hookServerPort));
			if (ctx.mcpServer) overrides.push(...buildCodexMcpOverrides(ctx.mcpServer));
			if (ctx.appendSystemPrompt) overrides.push(...buildCodexDeveloperInstructions(ctx.appendSystemPrompt));
			if (ctx.effort) overrides.push(...buildCodexEffortOverride(ctx.effort));

			const args: string[] = [...overrides];
			if (mode === "print") {
				args.push("exec", "--dangerously-bypass-approvals-and-sandbox", prompt);
			} else {
				args.push("--dangerously-bypass-approvals-and-sandbox");
				if (prompt.trim()) args.push(prompt);
			}
			return args;
		}
		default:
			throw new Error(`Unknown agent: ${agentId satisfies never}`);
	}
}
