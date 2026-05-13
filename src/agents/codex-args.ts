import { createHash } from "node:crypto";
import type { EffortLevel } from "../core/api-contract.js";
import { HOOK_TASK_ID_ENV, HOOK_WORKSPACE_ID_ENV } from "./agent-hooks.js";

// Codex exposes a stable `hooks` feature whose config is supplied inline via
// `-c` TOML overrides (no settings.json equivalent). We mirror Claude's
// Stop / UserPromptSubmit hooks so the daemon receives the same lifecycle
// events for both agents. Trust state hashes are required so codex won't
// prompt the user to approve the inline hook commands.

const CODEX_HOOK_TIMEOUT_SECONDS = 5;

type CodexHookEvent = "Stop" | "UserPromptSubmit";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

interface CodexHookConfig {
	eventName: CodexHookEvent;
	command: string;
}

function buildHookCurlCommand(event: string, serverPort: number): string {
	// Codex requires hooks to write a JSON object to stdout (e.g. {}) — if we
	// emit the server's "ok" response, codex logs "invalid stop hook JSON output"
	// and treats the hook as failed. Discard the curl output and always print {}.
	const url = `http://127.0.0.1:${serverPort}/api/hook?event=${event}&taskId=$${HOOK_TASK_ID_ENV}&workspaceId=$${HOOK_WORKSPACE_ID_ENV}`;
	return `curl -sg "${url}" >/dev/null 2>&1; echo '{}'`;
}

function buildCodexHookConfigValue(command: string): string {
	return `[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=${CODEX_HOOK_TIMEOUT_SECONDS}}]}]`;
}

function codexEventKeyLabel(event: CodexHookEvent): string {
	return event === "Stop" ? "stop" : "user_prompt_submit";
}

function canonicalizeJson(value: JsonValue): JsonValue {
	if (Array.isArray(value)) return value.map(canonicalizeJson);
	if (value !== null && typeof value === "object") {
		const sorted: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value).sort()) sorted[key] = canonicalizeJson(value[key] as JsonValue);
		return sorted;
	}
	return value;
}

function buildCodexHookTrustEntry(config: CodexHookConfig): { key: string; trustedHash: string } {
	const handler = { async: false, command: config.command, timeout: CODEX_HOOK_TIMEOUT_SECONDS, type: "command" };
	const eventKey = codexEventKeyLabel(config.eventName);
	const identity = { event_name: eventKey, hooks: [handler] };
	const hash = createHash("sha256").update(JSON.stringify(canonicalizeJson(identity as JsonValue))).digest("hex");
	return {
		// `<session-flags>` is codex's internal sentinel for configs injected via `-c`.
		key: `/<session-flags>/config.toml:${eventKey}:0:0`,
		trustedHash: `sha256:${hash}`,
	};
}

function buildCodexHookTrustState(entries: { key: string; trustedHash: string }[]): string {
	const items = entries.map((e) => `${JSON.stringify(e.key)}={trusted_hash=${JSON.stringify(e.trustedHash)}}`);
	return `{${items.join(",")}}`;
}

export function buildCodexHookOverrides(serverPort: number): string[] {
	const userPromptHook: CodexHookConfig = {
		eventName: "UserPromptSubmit",
		command: buildHookCurlCommand("user_prompt", serverPort),
	};
	const stopHook: CodexHookConfig = {
		eventName: "Stop",
		command: buildHookCurlCommand("stop", serverPort),
	};
	const trustState = buildCodexHookTrustState([userPromptHook, stopHook].map(buildCodexHookTrustEntry));
	return [
		"-c", "features.hooks=true",
		"-c", `hooks.state=${trustState}`,
		"-c", `hooks.UserPromptSubmit=${buildCodexHookConfigValue(userPromptHook.command)}`,
		"-c", `hooks.Stop=${buildCodexHookConfigValue(stopHook.command)}`,
	];
}

export function buildCodexMcpOverrides(mcp: { command: string; args: string[] }): string[] {
	const cmd = JSON.stringify(mcp.command);
	const argsToml = `[${mcp.args.map((a) => JSON.stringify(a)).join(",")}]`;
	return [
		"-c", `mcp_servers.kanbom.command=${cmd}`,
		"-c", `mcp_servers.kanbom.args=${argsToml}`,
	];
}

export function buildCodexDeveloperInstructions(text: string): string[] {
	return ["-c", `developer_instructions=${JSON.stringify(text)}`];
}

// Codex accepts low/medium/high. We collapse xhigh/max → high.
const CODEX_EFFORT_MAP: Record<EffortLevel, string> = {
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "high",
	max: "high",
};

export function buildCodexEffortOverride(effort: EffortLevel): string[] {
	return ["-c", `model_reasoning_effort=${CODEX_EFFORT_MAP[effort]}`];
}
