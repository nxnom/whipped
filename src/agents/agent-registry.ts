import { spawnSync } from "node:child_process";
import type { RuntimeAgentId } from "../core/api-contract.js";

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

// "interactive": stays alive after finishing (task agents — Stop hook handles completion).
// "print": exits when done (review agents — onExit resolves the promise).
export function buildAgentArgs(agentId: RuntimeAgentId, prompt: string, mode: "interactive" | "print" = "interactive"): string[] {
	switch (agentId) {
		case "claude": {
			if (mode === "print") return ["-p", prompt, "--dangerously-skip-permissions"];
			const args = ["--dangerously-skip-permissions"];
			if (prompt.trim()) args.push(prompt);
			return args;
		}
		case "codex":
			return ["-q", "--approval-mode", "full-auto", "-m", "o4-mini", prompt];
		default:
			throw new Error(`Unknown agent: ${agentId}`);
	}
}
