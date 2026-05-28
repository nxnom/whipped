import { join } from "node:path";
import { type RuntimeGlobalConfig, runtimeGlobalConfigSchema } from "../core/api-contract.js";
import { getDb } from "../state/db.js";
import { WHIPPED_HOME_DIR } from "./paths.js";

// Re-exported here so existing callers keep working after the path constants
// moved into a dependency-free module (see ./paths.ts for the rationale).
export { WHIPPED_HOME_DIR };
// Legacy JSON path — kept exported for the future one-time JSON→SQLite import.
// Live reads/writes now go through SQLite via global_config singleton row.
export const CONFIG_FILE = join(WHIPPED_HOME_DIR, "config.json");
export const WORKSPACES_DIR = join(WHIPPED_HOME_DIR, "workspaces");
export const ATTACHMENTS_DIR = join(WHIPPED_HOME_DIR, "attachments");
export const DEFAULT_PORT = 50008;
export const DEFAULT_WEB_UI_PORT = 50007;

function parseConfig(rawJson: string): RuntimeGlobalConfig {
	try {
		const parsed = runtimeGlobalConfigSchema.safeParse(JSON.parse(rawJson));
		if (parsed.success) return parsed.data;
	} catch {
		// fall through to defaults
	}
	return runtimeGlobalConfigSchema.parse({});
}

export async function loadGlobalConfig(): Promise<RuntimeGlobalConfig> {
	const db = getDb();
	const row = db.prepare("SELECT config_json FROM global_config WHERE id = 1").get() as
		| { config_json: string }
		| undefined;
	if (!row) return runtimeGlobalConfigSchema.parse({});
	return parseConfig(row.config_json);
}

export async function saveGlobalConfig(config: RuntimeGlobalConfig): Promise<void> {
	const db = getDb();
	db.prepare("UPDATE global_config SET config_json = ?, updated_at = ? WHERE id = 1").run(
		JSON.stringify(config),
		Date.now(),
	);
}

export async function updateGlobalConfig(patch: Partial<RuntimeGlobalConfig>): Promise<RuntimeGlobalConfig> {
	const db = getDb();
	const tx = db.transaction((p: Partial<RuntimeGlobalConfig>) => {
		const row = db.prepare("SELECT config_json FROM global_config WHERE id = 1").get() as
			| { config_json: string }
			| undefined;
		const current = row ? parseConfig(row.config_json) : runtimeGlobalConfigSchema.parse({});
		const updated = runtimeGlobalConfigSchema.parse({ ...current, ...p });
		db.prepare("UPDATE global_config SET config_json = ?, updated_at = ? WHERE id = 1").run(
			JSON.stringify(updated),
			Date.now(),
		);
		return updated;
	});
	return tx(patch);
}
