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
