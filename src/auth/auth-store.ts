import { randomBytes } from "node:crypto";
import { loadGlobalConfig, updateGlobalConfig } from "../config/runtime-config.js";

// Both the password hash and the session signing secret live in the encrypted
// global_config blob (see config/runtime-config.ts) — no separate auth table.

export async function getPasswordHash(): Promise<string | undefined> {
	return (await loadGlobalConfig()).authPasswordHash;
}

export async function isPasswordSet(): Promise<boolean> {
	return Boolean(await getPasswordHash());
}

export async function setPasswordHash(hash: string): Promise<void> {
	await updateGlobalConfig({ authPasswordHash: hash });
}

export async function getSessionSecret(): Promise<string | undefined> {
	return (await loadGlobalConfig()).authSessionSecret;
}

// Lazily created on first login/setup. Rotating it invalidates all sessions.
export async function getOrCreateSessionSecret(): Promise<string> {
	const existing = await getSessionSecret();
	if (existing) return existing;
	const secret = randomBytes(32).toString("hex");
	await updateGlobalConfig({ authSessionSecret: secret });
	return secret;
}

// Created once at startup; the daemon injects it into agent subprocesses so the
// MCP server and hooks authenticate as the local machine.
export async function getOrCreateMachineToken(): Promise<string> {
	const cfg = await loadGlobalConfig();
	if (cfg.authMachineToken) return cfg.authMachineToken;
	const token = randomBytes(32).toString("hex");
	await updateGlobalConfig({ authMachineToken: token });
	return token;
}
