import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "../core/logger.js";

const CLAUDE_CONFIG_PATH = join(homedir(), ".claude.json");
const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");

interface ClaudeConfig {
	projects?: Record<string, Record<string, unknown>>;
	[key: string]: unknown;
}

function resolveRealpath(dir: string): string {
	try {
		return realpathSync(dir);
	} catch {
		// dir may not exist yet — fall back to the given path
		return dir;
	}
}

/**
 * Pre-accepts claude's per-folder "trust this project?" dialog so a spawned session
 * never blocks on it. Claude honors a trusted parent folder for its subdirectories
 * (verified empirically), so trusting the whipped home dir once covers every
 * worktree/workspace whipped creates under it.
 */
export function ensureClaudeTrusted(dir: string): void {
	const real = resolveRealpath(dir);

	let config: ClaudeConfig = {};
	try {
		config = JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, "utf8"));
	} catch {
		// no config yet, or unreadable — start fresh
	}

	config.projects = config.projects ?? {};
	const existing = config.projects[real] ?? {};
	if (existing.hasTrustDialogAccepted && existing.hasCompletedProjectOnboarding) return;

	config.projects[real] = {
		...existing,
		hasTrustDialogAccepted: true,
		hasCompletedProjectOnboarding: true,
	};

	try {
		writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2));
	} catch (err) {
		logger.warn({ err, dir: real }, "[trust] failed to pre-trust workspace for claude");
	}
}

/**
 * Pre-accepts codex's per-folder trust prompt. Unlike claude, codex trusts folders by
 * exact path only — it does not honor a trusted parent for subdirectories — so this must
 * be called with the specific cwd being spawned into (a fresh worktree path each run),
 * not just the whipped home dir once at startup.
 */
export function ensureCodexTrusted(dir: string): void {
	const real = resolveRealpath(dir);
	const header = `[projects."${real.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;

	let contents = "";
	try {
		contents = readFileSync(CODEX_CONFIG_PATH, "utf8");
	} catch {
		// no config yet — codex creates ~/.codex on first run
	}

	if (contents.includes(header)) return;

	const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
	const block = `${separator}\n${header}\ntrust_level = "trusted"\n`;

	try {
		if (!existsSync(dirname(CODEX_CONFIG_PATH))) {
			mkdirSync(dirname(CODEX_CONFIG_PATH), { recursive: true });
		}
		writeFileSync(CODEX_CONFIG_PATH, contents + block);
	} catch (err) {
		logger.warn({ err, dir: real }, "[trust] failed to pre-trust workspace for codex");
	}
}
