// Runs after `npm install -g whipped`. Only shows a message for global installs.
if (process.env.npm_config_global !== "true") process.exit(0);

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const homeDir = process.env.WHIPPED_HOME_DIR ?? join(homedir(), ".whipped");
const statePath = join(homeDir, "daemon.pid");

let isRunning = false;
let url = "";

if (existsSync(statePath)) {
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		if (typeof state.pid === "number") {
			try {
				process.kill(state.pid, 0);
				isRunning = true;
				url = state.url ?? "";
			} catch {
				// process not alive
			}
		}
	} catch {
		// ignore parse errors
	}
}

if (isRunning) {
	process.stdout.write(
		`\n✓ whipped updated.\n\n` +
		`  A whipped daemon is already running${url ? ` at ${url}` : ""}.\n` +
		`  Run \`whipped restart\` to apply the update.\n\n`,
	);
} else {
	process.stdout.write(
		`\n✓ whipped installed.\n\n` +
		`  Run \`whipped\` inside a git repo to start the board.\n` +
		`  Run \`whipped start\` to run it as a background daemon.\n\n`,
	);
}
