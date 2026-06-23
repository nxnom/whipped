import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WHIPPED_HOME_DIR } from "../config/runtime-config.js";

const LOGS_DIR = join(WHIPPED_HOME_DIR, "logs");

export function getTodayLogPath(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(LOGS_DIR, `whipped-${date}.log`);
}

interface LogsOptions {
	follow: boolean;
	lines: number;
}

export async function runLogs(options: LogsOptions): Promise<void> {
	const path = getTodayLogPath();
	if (!existsSync(path)) {
		console.error(`No log file for today yet: ${path}`);
		console.error("Run `whipped start` (or the foreground default) to generate one.");
		process.exit(1);
	}

	if (options.follow) {
		// Windows has no `tail`; PowerShell's `Get-Content -Wait -Tail N` is the equivalent.
		const [cmd, args] =
			process.platform === "win32"
				? ([
						"powershell",
						["-NoProfile", "-Command", `Get-Content -Path '${path}' -Tail ${options.lines} -Wait`],
					] as const)
				: (["tail", ["-f", "-n", String(options.lines), path]] as const);
		const child = spawn(cmd, args, {
			stdio: "inherit",
		});
		child.on("error", (err) => {
			console.error(`Failed to follow log file: ${err.message}`);
			process.exit(1);
		});
		child.on("exit", (code) => process.exit(code ?? 0));
		return;
	}

	const text = readFileSync(path, "utf-8");
	const allLines = text.split("\n");
	const tail = allLines.slice(-options.lines - 1);
	console.log(tail.join("\n"));
}
