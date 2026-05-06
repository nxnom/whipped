import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HOOKS_DIR = join(homedir(), ".kanbom", "hooks");
export const CLAUDE_TASK_SETTINGS_PATH = join(HOOKS_DIR, "claude-task-settings.json");
export const CLAUDE_HOME_MCP_CONFIG_PATH = join(HOOKS_DIR, "claude-home-mcp-config.json");
export const CLAUDE_REVIEW_MCP_CONFIG_PATH = join(HOOKS_DIR, "claude-review-mcp-config.json");

export const HOOK_TASK_ID_ENV = "KANBOM_HOOK_TASK_ID";
export const HOOK_WORKSPACE_ID_ENV = "KANBOM_HOOK_WORKSPACE_ID";

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

	const settings = {
		hooks: {
			Stop: [{ hooks: [{ type: "command", command: `curl -sg "${url("stop")}"` }] }],
			UserPromptSubmit: [{ hooks: [{ type: "command", command: `curl -sg "${url("user_prompt")}"` }] }],
		},
	};

	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(CLAUDE_TASK_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function buildMcpConfig(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId?: string,
): object {
	return {
		mcpServers: {
			kanbom: {
				command: mcp.command,
				args: [...mcp.args, serverUrl, workspaceId, ...(agentId ? [agentId] : [])],
			},
		},
	};
}

// Writes a settings.json for the home agent (Kanban Agent) that registers the
// kanbom MCP server so Claude has typed tools to manage the board.
export async function writeClaudeHomeSettings(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
): Promise<void> {
	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(CLAUDE_HOME_MCP_CONFIG_PATH, JSON.stringify(buildMcpConfig(mcp, serverUrl, workspaceId), null, 2));
}

// Generic writer — writes MCP config to a caller-supplied path.
// Allows each concurrent agent to use its own isolated config file.
export async function writeClaudeMcpConfig(
	mcp: { command: string; args: string[] },
	serverUrl: string,
	workspaceId: string,
	agentId: string,
	configPath: string,
): Promise<void> {
	await mkdir(HOOKS_DIR, { recursive: true });
	await writeFile(configPath, JSON.stringify(buildMcpConfig(mcp, serverUrl, workspaceId, agentId), null, 2));
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
	};
}
