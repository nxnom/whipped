import { spawnSync } from "node:child_process";
import type { EffortLevel, RuntimeAgentId } from "../core/api-contract.js";

// opencode and its fork mimo both print `provider/model` strings, one per line,
// from `<binary> models`. Shared parser; empty list if the binary is missing.
function getProviderModels(binary: string): string[] {
	try {
		const result = spawnSync(binary, ["models"], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10_000,
			encoding: "utf-8",
		});
		if (result.status === 0 && result.stdout) {
			return result.stdout
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0 && l.includes("/"));
		}
	} catch {
		/* binary not installed or failed */
	}
	return [];
}

export function getOpencodeModels(): string[] {
	return getProviderModels("opencode");
}

export function getMimoModels(): string[] {
	return getProviderModels("mimo");
}

export function getCursorModels(): Array<{ value: string; label: string }> {
	try {
		const result = spawnSync("agent", ["models"], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10_000,
			encoding: "utf-8",
		});
		if (result.status === 0 && result.stdout) {
			return result.stdout
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0 && l.includes(" - "))
				.map((l) => {
					const sep = l.indexOf(" - ");
					const value = l.slice(0, sep).trim();
					const label = l
						.slice(sep + 3)
						.replace(/\s*\((current|default)\)\s*$/i, "")
						.trim();
					return { value, label };
				});
		}
	} catch {
		/* agent not installed or failed */
	}
	return [];
}
import {
	buildCodexDeveloperInstructions,
	buildCodexEffortOverride,
	buildCodexHookOverrides,
	buildCodexMcpOverrides,
	buildCodexNamedMcpOverrides,
} from "./codex-args.js";
import { PLAYWRIGHT_MCP_SERVER_NAME } from "./playwright-mcp.js";

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
	{
		id: "opencode",
		label: "OpenCode",
		command: "opencode",
		checkCommand: ["opencode", "--version"],
	},
	{
		id: "cursor",
		label: "Cursor Agent",
		command: "agent",
		checkCommand: ["agent", "--version"],
	},
	{
		id: "mimo",
		label: "MiMo Code",
		command: "mimo",
		checkCommand: ["mimo", "--version"],
	},
];

function isCommandAvailable(args: string[]): boolean {
	const result = spawnSync(args[0]!, args.slice(1), {
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 5000,
	});
	// A binary that isn't on PATH surfaces as a spawn error (ENOENT) with a null
	// status — that means "not installed", not "available". Any other spawn error
	// (e.g. the --version call timing out) still means the binary exists.
	if (result.error) return (result.error as NodeJS.ErrnoException).code !== "ENOENT";
	// Exited normally (0) or was killed by our timeout after starting (null) → installed.
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
	// Extra MCP server (browser capability for QA). Claude/opencode/cursor get it
	// via their written config files; codex inlines it as `-c` overrides here.
	browserMcpServer?: { command: string; args: string[] };
	appendSystemPrompt?: string;
	files?: string[];
	effort?: EffortLevel | null;
	// Model name or alias. Empty/undefined uses the agent's default.
	// Claude: 'opus', 'sonnet', 'haiku', or a full ID. Codex: e.g. 'gpt-5', 'gpt-5-codex'.
	model?: string | null;
	// Run the agent read-only (no file writes / shell). Enforced per binary:
	// claude → --disallowedTools; opencode → the built-in read-only `plan` agent.
	// codex/cursor have no clean flag, so they fall back to prompt-only enforcement.
	readOnly?: boolean;
}

// Claude tools withheld in read-only mode — everything that can mutate the repo.
// (Deny wins over --dangerously-skip-permissions, so these are truly unavailable.)
const READONLY_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit", "Bash"];

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
			if (ctx.model) args.push("--model", ctx.model);
			if (ctx.hookSettingsPath) args.push("--settings", ctx.hookSettingsPath);
			if (ctx.mcpConfigPath) args.push("--mcp-config", ctx.mcpConfigPath);
			// Comma-joined single value so the parser can't swallow a following positional prompt.
			if (ctx.readOnly) args.push("--disallowedTools", READONLY_DISALLOWED_TOOLS.join(","));
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
			if (ctx.browserMcpServer) {
				overrides.push(...buildCodexNamedMcpOverrides(PLAYWRIGHT_MCP_SERVER_NAME, ctx.browserMcpServer));
			}
			if (ctx.appendSystemPrompt) overrides.push(...buildCodexDeveloperInstructions(ctx.appendSystemPrompt));
			if (ctx.effort) overrides.push(...buildCodexEffortOverride(ctx.effort));

			const args: string[] = [...overrides];
			if (ctx.model) args.push("-m", ctx.model);
			if (mode === "print") {
				args.push("exec", "--dangerously-bypass-approvals-and-sandbox", prompt);
			} else {
				args.push("--dangerously-bypass-approvals-and-sandbox");
				if (prompt.trim()) args.push(prompt);
			}
			return args;
		}
		// mimo (mimocode) is an opencode fork with an identical CLI surface
		// (`run`/`--agent build`/`-m`/`--prompt`/`--variant`), so it shares this branch.
		case "opencode":
		case "mimo": {
			// --agent build: built-in agent with permission "*" allow "*" (skip-permissions equivalent).
			// Read-only is enforced in the config file (writePluginAgentFiles disables the
			// write/edit/bash tools) — we keep the autonomous `build` agent rather than
			// the built-in `plan` agent, which is an interactive approval-seeking mode.
			if (mode === "print") {
				// One-shot non-interactive run (review pipeline slots).
				// `run` supports --variant; --prompt is not used here (prompt is a positional).
				const args: string[] = ["run", "--agent", "build"];
				if (ctx.model) args.push("-m", ctx.model);
				if (ctx.effort) {
					// --variant must match one of the model's reasoning-effort values. mimo's
					// catalog names these exactly as whipped's EffortLevel (low/medium/high/
					// xhigh/max), so pass the level straight through. opencode's variant scale
					// is shifted (starts at "minimal"), so it needs remapping.
					const OPENCODE_EFFORT_VARIANT: Record<EffortLevel, string> = {
						low: "minimal",
						medium: "low",
						high: "medium",
						xhigh: "high",
						max: "max",
					};
					args.push("--variant", agentId === "mimo" ? ctx.effort : OPENCODE_EFFORT_VARIANT[ctx.effort]);
				}
				if (prompt.trim()) args.push(prompt);
				return args;
			}
			// Interactive TUI (dev agent). `--prompt` seeds the initial message.
			// --variant is not available on the root TUI command.
			const args: string[] = ["--agent", "build"];
			if (ctx.model) args.push("-m", ctx.model);
			if (prompt.trim()) args.push("--prompt", prompt);
			return args;
		}
		case "cursor": {
			// Cursor agent CLI: --yolo skips permission prompts, --approve-mcps auto-approves MCP,
			// MCP servers configured via CURSOR_CONFIG_DIR/mcp.json (written by the caller).
			// No --append-system-prompt flag exists; prepend context to the initial prompt instead.
			const args: string[] = ["--yolo", "--approve-mcps"];
			if (ctx.model) args.push("--model", ctx.model);
			const fullPrompt = ctx.appendSystemPrompt ? `${ctx.appendSystemPrompt}\n\n${prompt}` : prompt;
			if (mode === "print") {
				args.push("-p", fullPrompt);
			} else {
				if (fullPrompt.trim()) args.push(fullPrompt);
			}
			return args;
		}
		default:
			throw new Error(`Unknown agent: ${agentId satisfies never}`);
	}
}
