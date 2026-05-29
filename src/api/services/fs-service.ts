import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlobalConfig } from "../../config/runtime-config.js";
import { listTerminalApps, openTerminalAt } from "../../core/terminal-apps.js";

export const openPath = (path: string) => {
	const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
	spawnSync(cmd, [path], { stdio: "ignore" });
	return { ok: true };
};

export const getExtensionPath = () => {
	// Resolves from dist/api/services/ (prod) or src/api/services/ (dev) up to the project root.
	const thisDir = fileURLToPath(new URL(".", import.meta.url));
	const candidates = [
		resolve(thisDir, "..", "..", "..", "extension"),
		resolve(thisDir, "..", "..", "..", "..", "extension"),
	];
	const found = candidates.find((p) => existsSync(p));
	return { path: found ?? null };
};

export const listTerminals = async () => listTerminalApps();

export const openTerminal = async (path: string) => {
	const config = await loadGlobalConfig();
	openTerminalAt(path, config.terminalApp);
	return { ok: true };
};

export const listDir = async (path: string, includeFiles?: boolean, showHidden?: boolean) => {
	// Walk up to the nearest existing directory so a not-yet-created path
	// (e.g. .whipped/prompts/ before first save) never dead-ends the picker.
	let target = resolve(path || homedir());
	while (target !== dirname(target) && !(existsSync(target) && statSync(target).isDirectory())) {
		target = dirname(target);
	}

	const parent = dirname(target);
	const visible = (name: string) => showHidden || !name.startsWith(".");
	try {
		const entries = readdirSync(target, { withFileTypes: true });
		const dirs = entries
			.filter((e) => e.isDirectory() && visible(e.name))
			.map((e) => ({ name: e.name, path: join(target, e.name) }))
			.sort((a, b) => a.name.localeCompare(b.name));
		const files = includeFiles
			? entries
					.filter((e) => e.isFile() && visible(e.name))
					.map((e) => ({ name: e.name, path: join(target, e.name) }))
					.sort((a, b) => a.name.localeCompare(b.name))
			: [];
		return { current: target, parent: parent !== target ? parent : null, dirs, files };
	} catch {
		return { current: target, parent: parent !== target ? parent : null, dirs: [], files: [] };
	}
};
