import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OVEREMPLOYED_HOME_DIR } from "../config/runtime-config.js";

const LOGS_DIR = join(OVEREMPLOYED_HOME_DIR, "logs");

export function getTodayLogPath(): string {
	const date = new Date().toISOString().slice(0, 10);
	return join(LOGS_DIR, `overemployed-${date}.log`);
}

interface LogsOptions {
	follow: boolean;
	lines: number;
}

export async function runLogs(options: LogsOptions): Promise<void> {
	const path = getTodayLogPath();
	if (!existsSync(path)) {
		console.error(`No log file for today yet: ${path}`);
		console.error("Run `overemployed start` (or the foreground default) to generate one.");
		process.exit(1);
	}

	if (options.follow) {
		const child = spawn("tail", ["-f", "-n", String(options.lines), path], {
			stdio: "inherit",
		});
		child.on("error", (err) => {
			console.error(`Failed to spawn tail: ${err.message}`);
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
