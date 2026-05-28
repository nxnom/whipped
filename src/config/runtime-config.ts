import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type RuntimeGlobalConfig, runtimeGlobalConfigSchema } from "../core/api-contract.js";

export const WHIPPED_HOME_DIR = join(homedir(), ".whipped");
export const CONFIG_FILE = join(WHIPPED_HOME_DIR, "config.json");
export const WORKSPACES_DIR = join(WHIPPED_HOME_DIR, "workspaces");
export const ATTACHMENTS_DIR = join(WHIPPED_HOME_DIR, "attachments");
export const DEFAULT_PORT = 50008;
export const DEFAULT_WEB_UI_PORT = 50007;

let configLock: Promise<void> = Promise.resolve();

async function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
	let release!: () => void;
	const next = new Promise<void>((resolve) => {
		release = resolve;
	});
	const prev = configLock;
	configLock = next;
	await prev;
	try {
		return await fn();
	} finally {
		release();
	}
}

export async function loadGlobalConfig(): Promise<RuntimeGlobalConfig> {
	try {
		const raw = await readFile(CONFIG_FILE, "utf-8");
		const parsed = runtimeGlobalConfigSchema.safeParse(JSON.parse(raw));
		if (parsed.success) {
			return parsed.data;
		}
		return runtimeGlobalConfigSchema.parse({});
	} catch {
		return runtimeGlobalConfigSchema.parse({});
	}
}

export async function saveGlobalConfig(config: RuntimeGlobalConfig): Promise<void> {
	await mkdir(WHIPPED_HOME_DIR, { recursive: true });
	await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function updateGlobalConfig(patch: Partial<RuntimeGlobalConfig>): Promise<RuntimeGlobalConfig> {
	return withConfigLock(async () => {
		const current = await loadGlobalConfig();
		const updated = runtimeGlobalConfigSchema.parse({ ...current, ...patch });
		await saveGlobalConfig(updated);
		return updated;
	});
}
