import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TerminalApp {
	id: string;
	label: string;
}

const MACOS_TERMINALS: Array<{ bundle: string; label: string }> = [
	{ bundle: "Terminal", label: "Terminal" },
	{ bundle: "iTerm", label: "iTerm" },
	{ bundle: "Warp", label: "Warp" },
	{ bundle: "Ghostty", label: "Ghostty" },
	{ bundle: "WezTerm", label: "WezTerm" },
	{ bundle: "Alacritty", label: "Alacritty" },
	{ bundle: "kitty", label: "kitty" },
	{ bundle: "Hyper", label: "Hyper" },
];

const LINUX_TERMINALS: Array<{ bin: string; label: string }> = [
	{ bin: "gnome-terminal", label: "GNOME Terminal" },
	{ bin: "konsole", label: "Konsole" },
	{ bin: "xfce4-terminal", label: "Xfce Terminal" },
	{ bin: "tilix", label: "Tilix" },
	{ bin: "terminator", label: "Terminator" },
	{ bin: "alacritty", label: "Alacritty" },
	{ bin: "kitty", label: "kitty" },
	{ bin: "wezterm", label: "WezTerm" },
	{ bin: "xterm", label: "xterm" },
];

const WINDOWS_TERMINALS: Array<{ id: string; label: string; check: string }> = [
	{ id: "wt", label: "Windows Terminal", check: "wt" },
	{ id: "powershell", label: "PowerShell", check: "powershell" },
	{ id: "cmd", label: "Command Prompt", check: "cmd" },
];

function appExists(bundle: string): boolean {
	const paths = [
		`/Applications/${bundle}.app`,
		`/System/Applications/${bundle}.app`,
		`/System/Applications/Utilities/${bundle}.app`,
		join(homedir(), "Applications", `${bundle}.app`),
	];
	return paths.some((p) => existsSync(p));
}

function binaryExists(bin: string): boolean {
	// Windows has no `which`; use `where` (which.exe doesn't exist, where.exe does).
	const finder = process.platform === "win32" ? "where" : "which";
	const r = spawnSync(finder, [bin], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" });
	return r.status === 0 && r.stdout.trim().length > 0;
}

export function listTerminalApps(): TerminalApp[] {
	if (process.platform === "darwin") {
		return MACOS_TERMINALS.filter((t) => appExists(t.bundle)).map((t) => ({ id: t.bundle, label: t.label }));
	}
	if (process.platform === "win32") {
		return WINDOWS_TERMINALS.filter((t) => binaryExists(t.check)).map((t) => ({ id: t.id, label: t.label }));
	}
	return LINUX_TERMINALS.filter((t) => binaryExists(t.bin)).map((t) => ({ id: t.bin, label: t.label }));
}

export function openTerminalAt(path: string, preferredId?: string): void {
	if (process.platform === "darwin") {
		const bundle = preferredId && appExists(preferredId) ? preferredId : "Terminal";
		spawnSync("open", ["-a", bundle, path], { stdio: "ignore" });
		return;
	}

	if (process.platform === "win32") {
		const id =
			preferredId && WINDOWS_TERMINALS.some((t) => t.id === preferredId && binaryExists(t.check)) ? preferredId : "cmd";
		if (id === "wt") {
			spawnSync("wt", ["-d", path], { stdio: "ignore" });
		} else if (id === "powershell") {
			spawnSync("cmd", ["/c", "start", "powershell", "-NoExit", "-Command", `Set-Location -Path '${path}'`], {
				stdio: "ignore",
			});
		} else {
			spawnSync("cmd", ["/c", "start", "cmd", "/K", `cd /D "${path}"`], { stdio: "ignore" });
		}
		return;
	}

	const bin =
		preferredId && binaryExists(preferredId) ? preferredId : LINUX_TERMINALS.find((t) => binaryExists(t.bin))?.bin;
	if (!bin) return;

	const args = linuxLaunchArgs(bin, path);
	spawnSync(bin, args, { stdio: "ignore" });
}

function linuxLaunchArgs(bin: string, path: string): string[] {
	switch (bin) {
		case "gnome-terminal":
		case "tilix":
		case "xfce4-terminal":
			return [`--working-directory=${path}`];
		case "konsole":
			return ["--workdir", path];
		case "terminator":
			return ["--working-directory", path];
		case "alacritty":
		case "kitty":
		case "wezterm":
			return ["--working-directory", path];
		case "xterm":
			return ["-e", `cd "${path}" && exec $SHELL`];
		default:
			return ["--working-directory", path];
	}
}
