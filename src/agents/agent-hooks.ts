import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getMachineToken, MACHINE_TOKEN_ENV, MACHINE_TOKEN_HEADER } from "../auth/machine-token.js";
import { WHIPPED_HOME_DIR } from "../config/paths.js";
import type { RuntimeAgentId } from "../core/api-contract.js";

const HOOKS_DIR = join(WHIPPED_HOME_DIR, "hooks");
export const CLAUDE_TASK_SETTINGS_PATH = join(HOOKS_DIR, "claude-task-settings.json");
export const CLAUDE_ASSISTANT_MCP_CONFIG_PATH = join(HOOKS_DIR, "claude-assistant-mcp-config.json");
export const CLAUDE_REVIEW_MCP_CONFIG_PATH = join(HOOKS_DIR, "claude-review-mcp-config.json");

export const HOOK_TASK_ID_ENV = "WHIPPED_HOOK_TASK_ID";
export const HOOK_WORKSPACE_ID_ENV = "WHIPPED_HOOK_WORKSPACE_ID";

// Extract the port the runtime server is listening on from a server URL string.
// Used by the codex adapter to build inline hook commands.
export function getServerPort(serverUrl: string): number {
	try {
		return Number(new URL(serverUrl).port) || 0;
	} catch {
		return 0;
	}
}

export function getMcpConfigPath(id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(HOOKS_DIR, `claude-mcp-config-${safe}.json`);
}

// Writes a shared settings.json that injects Stop/UserPromptSubmit hooks into
// every claude task session. The task and workspace IDs are injected via env
// vars at spawn time so one file serves all concurrent tasks.
export async function writeClaudeTaskHookSettings(serverPort: number): Promise<void> {
	const url = (event: string) =>
		`http://127.0.0.1:${serverPort}/api/hook?event=${event}&taskId=$${HOOK_TASK_ID_ENV}&workspaceId=$${HOOK_WORKSPACE_ID_ENV}`;

	const auth = `-H "${MACHINE_TOKEN_HEADER}: $${MACHINE_TOKEN_ENV}"`;
	const settings = {
		skipDangerousModePermissionPrompt: true,
		hooks: {
			Stop: [{ hooks: [{ type: "command", command: `curl -sg ${auth} "${url("stop")}"` }] }],
			UserPromptSubmit: [{ hooks: [{ type: "command", command: `curl -sg ${auth} "${url("user_prompt")}"` }] }],
		},
	};

	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(CLAUDE_TASK_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

// Extra positional args appended to the MCP server spec to scope its tool set.
// `--role` gates which tools the server registers (assistant gets recurring-agent
// management; recurring agents get update_journal); `--recurring-agent-id` tells a
// recurring agent's update_journal which row to write. Passed as named flags so
// they survive regardless of whether agentId is present (position-independent).
export function buildMcpRoleArgs(role?: string, recurringAgentId?: string): string[] {
	const args: string[] = [];
	if (role) args.push(`--role=${role}`);
	if (recurringAgentId) args.push(`--recurring-agent-id=${recurringAgentId}`);
	return args;
}

// The raw {command, args} pair for the whipped MCP server. Claude consumes the
// JSON shape via buildMcpConfig; codex inlines this spec via `-c` overrides.
export function buildWhippedMcpServerSpec(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId?: string,
	extraArgs: string[] = [],
): { command: string; args: string[] } {
	return {
		command: mcp.command,
		args: [...mcp.args, serverUrl, workspaceId, ...(agentId ? [agentId] : []), ...extraArgs],
	};
}

// Extra MCP servers (e.g. the browser capability for QA) keyed by name. These
// talk to local tools rather than the daemon, so they carry no machine token.
export type ExtraMcpServers = Record<string, { command: string; args: string[] }>;

function buildMcpConfig(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId?: string,
	extraServers?: ExtraMcpServers,
	extraArgs?: string[],
): object {
	return {
		mcpServers: {
			whipped: {
				...buildWhippedMcpServerSpec(mcp, serverUrl, workspaceId, agentId, extraArgs),
				// MCP runs as a child of the agent; agents don't forward inherited env,
				// so the auth token must be set explicitly on the server config.
				env: { [MACHINE_TOKEN_ENV]: getMachineToken() ?? "" },
			},
			...extraServers,
		},
	};
}

// Writes a settings.json for the assistant agent (Kanban Agent) that registers the
// whipped MCP server so Claude has typed tools to manage the board.
export async function writeClaudeAssistantSettings(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
): Promise<void> {
	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(
		CLAUDE_ASSISTANT_MCP_CONFIG_PATH,
		JSON.stringify(
			buildMcpConfig(mcp, serverUrl, workspaceId, undefined, undefined, buildMcpRoleArgs("assistant")),
			null,
			2,
		),
	);
}

// Generic writer — writes MCP config to a caller-supplied path.
// Allows each concurrent agent to use its own isolated config file.
export async function writeClaudeMcpConfig(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId: string,
	configPath: string,
	extraServers?: ExtraMcpServers,
	extraArgs?: string[],
): Promise<void> {
	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(buildMcpConfig(mcp, serverUrl, workspaceId, agentId, extraServers, extraArgs), null, 2),
	);
}

// Writes a settings.json for review pipeline agents (code-review, QA, dev summary).
// Includes kanban_add_comment so agents can store their findings directly.
// Kept as a backwards-compat wrapper around writeClaudeMcpConfig.
export async function writeClaudeReviewMcpConfig(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId: string,
): Promise<void> {
	await writeClaudeMcpConfig(mcp, serverUrl, workspaceId, agentId, CLAUDE_REVIEW_MCP_CONFIG_PATH);
}

export function buildTaskHookEnv(taskId: string, workspaceId: string): Record<string, string> {
	return {
		[HOOK_TASK_ID_ENV]: taskId,
		[HOOK_WORKSPACE_ID_ENV]: workspaceId,
		[MACHINE_TOKEN_ENV]: getMachineToken() ?? "",
	};
}

// ─── Plugin-config agents (OpenCode-style) ─────────────────────────────────────
// OpenCode and its fork mimo (mimocode) use a TypeScript plugin system instead of
// shell-command hooks. We write a plugin + a JSON config to a per-task directory
// under HOOKS_DIR and point the agent's CONFIG_DIR env var at it, so the files are
// discovered without touching the worktree.
//
// The two agents differ in the env var name, config filename, and — crucially — how
// the plugin is authored. OpenCode resolves the published `@opencode-ai/plugin`
// package, so its plugin imports the typed `tool()` helper. mimo auto-installs
// `@mimo-ai/plugin` pinned to its own CLI version, which is only published under
// preview tags; the value import fails to resolve and the plugin is dropped. mimo's
// loader accepts a plain tool object, so its plugin omits the value import entirely
// (the `import type` is erased at load, and the system-transform hook needs no import).

interface PluginAgentSpec {
	configDirEnv: string;
	configFile: string;
	dirPrefix: string;
	// Lines prepended to the plugin (imports), or "" when none are resolvable.
	pluginHeader: string;
	// Type annotation on the exported plugin (": Plugin"), or "" when untyped.
	pluginExportType: string;
	// Wrapper around the tool definition object: ("tool(", ")") or ("", "").
	toolWrapperOpen: string;
	toolWrapperClose: string;
}

const PLUGIN_AGENT_SPECS = {
	opencode: {
		configDirEnv: "OPENCODE_CONFIG_DIR",
		configFile: "opencode.json",
		dirPrefix: "opencode",
		pluginHeader: 'import { tool } from "@opencode-ai/plugin"\nimport type { Plugin } from "@opencode-ai/plugin"\n\n',
		pluginExportType: ": Plugin",
		toolWrapperOpen: "tool(",
		toolWrapperClose: ")",
	},
	mimo: {
		configDirEnv: "MIMOCODE_CONFIG_DIR",
		configFile: "mimocode.json",
		dirPrefix: "mimo",
		pluginHeader: "",
		pluginExportType: "",
		toolWrapperOpen: "",
		toolWrapperClose: "",
	},
} satisfies Partial<Record<RuntimeAgentId, PluginAgentSpec>>;

export type PluginConfigAgent = keyof typeof PLUGIN_AGENT_SPECS;

export function isPluginConfigAgent(agentId: RuntimeAgentId): agentId is PluginConfigAgent {
	return agentId in PLUGIN_AGENT_SPECS;
}

function getPluginAgentConfigDir(agentId: PluginConfigAgent, id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(HOOKS_DIR, `${PLUGIN_AGENT_SPECS[agentId].dirPrefix}-${safe}`);
}

// Env entry pointing a plugin-config agent at its per-task config dir. Returns {}
// for agents that don't use this mechanism, so callers can spread it unconditionally.
export function pluginAgentConfigDirEnv(agentId: RuntimeAgentId, id: string): Record<string, string> {
	if (!isPluginConfigAgent(agentId)) return {};
	return { [PLUGIN_AGENT_SPECS[agentId].configDirEnv]: getPluginAgentConfigDir(agentId, id) };
}

export async function writePluginAgentFiles(
	agentId: PluginConfigAgent,
	id: string,
	serverPort: number,
	mcpServer: { command: string; args: string[] },
	opts: { appendSystemPrompt?: string; extraMcp?: ExtraMcpServers; readOnly?: boolean } = {},
): Promise<void> {
	const spec = PLUGIN_AGENT_SPECS[agentId];
	const dir = getPluginAgentConfigDir(agentId, id);
	await mkdir(join(dir, "plugin"), { recursive: true });

	const systemParts: string[] = [];
	if (opts.appendSystemPrompt) systemParts.push(opts.appendSystemPrompt);
	// Tell the agent about the task_complete tool so it knows to call it when done.
	systemParts.push(
		opts.readOnly
			? "When you have finished observing and recorded your notes with `update_journal`, call the `task_complete` tool to end the run. Do not ask for confirmation — act autonomously."
			: "When you have finished all your work (set PR metadata, and added your dev comment), call the `task_complete` tool to signal completion.",
	);

	const systemTransformHook = `\n    "experimental.chat.system.transform": async (_input, output) => {\n      ${systemParts.map((p) => `output.system.push(${JSON.stringify(p)})`).join("\n      ")}\n    },`;

	const plugin = `${spec.pluginHeader}export const WhippedPlugin${spec.pluginExportType} = async () => {
  const port = ${serverPort}

  return {${systemTransformHook}
    tool: {
      task_complete: ${spec.toolWrapperOpen}{
        description: "Signal that you have finished all work on this task. Call this after completing all code changes, setting PR metadata with kanban_set_pr_meta, and adding your summary with kanban_add_comment.",
        args: {},
        execute: async (_args, _ctx) => {
          const taskId = process.env.${HOOK_TASK_ID_ENV}
          const workspaceId = process.env.${HOOK_WORKSPACE_ID_ENV}
          if (taskId && workspaceId) {
            await fetch(\`http://127.0.0.1:\${port}/api/hook?event=stop&taskId=\${encodeURIComponent(taskId)}&workspaceId=\${encodeURIComponent(workspaceId)}\`, {
              headers: { "${MACHINE_TOKEN_HEADER}": process.env.${MACHINE_TOKEN_ENV} ?? "" }
            }).catch(() => {})
          }
          return "Task marked as complete."
        }
      }${spec.toolWrapperClose}
    },
  }
}
`;

	const extraMcp = Object.fromEntries(
		Object.entries(opts.extraMcp ?? {}).map(([name, spec]) => [
			name,
			{ type: "local", command: [spec.command, ...spec.args] },
		]),
	);
	const config = {
		// Read-only observer: disable the mutating tools entirely (so the agent
		// doesn't try them) and deny them at the permission layer as a backstop.
		...(opts.readOnly
			? {
					tools: { write: false, edit: false, patch: false, bash: false },
					permission: { edit: "deny", write: "deny", bash: "deny" },
				}
			: {}),
		mcp: {
			whipped: {
				type: "local",
				command: [mcpServer.command, ...mcpServer.args],
				environment: { [MACHINE_TOKEN_ENV]: getMachineToken() ?? "" },
			},
			...extraMcp,
		},
	};

	await Promise.all([
		writeFile(join(dir, "plugin", "whipped.ts"), plugin),
		writeFile(join(dir, spec.configFile), JSON.stringify(config, null, 2)),
	]);
}

export async function cleanupPluginAgentFiles(agentId: PluginConfigAgent, id: string): Promise<void> {
	await rm(getPluginAgentConfigDir(agentId, id), { recursive: true, force: true });
}

// ─── Cursor Agent support ─────────────────────────────────────────────────────
// Cursor reads config from CURSOR_CONFIG_DIR if set (same pattern as OPENCODE_CONFIG_DIR).
// We write a per-task isolated directory with settings.json (stop hook), mcp.json, and rules.

export const CURSOR_CONFIG_DIR_ENV = "CURSOR_CONFIG_DIR";

export function getCursorConfigDir(id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(HOOKS_DIR, `cursor-${safe}`);
}

// Writes settings.json (stop hook) and mcp.json into a per-task CURSOR_CONFIG_DIR.
// Cursor's hook format uses flat {"command": "..."} entries under lowercase event names.
// System prompt is NOT injected here — .cursor/rules/ is unreliable; instead the caller
// prepends it to the initial prompt via AgentArgsContext.appendSystemPrompt.
export async function writeCursorConfigFiles(
	id: string,
	serverPort: number,
	mcpServerSpec: { command: string; args: string[] },
	extraServers?: ExtraMcpServers,
): Promise<void> {
	const dir = getCursorConfigDir(id);
	await mkdir(dir, { recursive: true });

	const hookUrl = `http://127.0.0.1:${serverPort}/api/hook?event=stop&taskId=$${HOOK_TASK_ID_ENV}&workspaceId=$${HOOK_WORKSPACE_ID_ENV}`;
	const settings = {
		hooks: {
			stop: [{ command: `curl -sg -H "${MACHINE_TOKEN_HEADER}: $${MACHINE_TOKEN_ENV}" "${hookUrl}"` }],
		},
	};

	const mcpConfig = {
		mcpServers: {
			whipped: { ...mcpServerSpec, env: { [MACHINE_TOKEN_ENV]: getMachineToken() ?? "" } },
			...extraServers,
		},
	};

	await Promise.all([
		writeFile(join(dir, "settings.json"), JSON.stringify(settings, null, 2)),
		writeFile(join(dir, "mcp.json"), JSON.stringify(mcpConfig, null, 2)),
	]);
}

export async function cleanupCursorConfigDir(id: string): Promise<void> {
	await rm(getCursorConfigDir(id), { recursive: true, force: true });
}
