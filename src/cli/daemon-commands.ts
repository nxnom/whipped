import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { OVEREMPLOYED_HOME_DIR } from "../config/runtime-config.js";
import {
	clearState,
	type DaemonState,
	getStatePath,
	isAlive,
	readState,
	waitForExit,
	waitForPort,
	writeState,
} from "./daemon-state.js";

const DAEMON_LOG_DIR = join(OVEREMPLOYED_HOME_DIR, "logs");
const DAEMON_LOG_PATH = join(DAEMON_LOG_DIR, "daemon.log");

interface StartOptions {
	port: number;
	host: string;
}

export async function startDaemon(options: StartOptions): Promise<void> {
	const { port, host } = options;
	const existing = readState();
	if (existing && isAlive(existing.pid)) {
		console.log(`overemployed is already running at ${existing.url} (pid ${existing.pid})`);
		console.log("Use `overemployed restart` to restart, or `overemployed stop` to stop.");
		return;
	}
	if (existing) clearState();

	mkdirSync(DAEMON_LOG_DIR, { recursive: true });
	const out = openSync(DAEMON_LOG_PATH, "a");
	const err = openSync(DAEMON_LOG_PATH, "a");

	// Inherit execArgv so the tsx ESM loader (registered via --import/--require
	// in dev) carries over to the detached child. In production the bundle
	// is plain JS and execArgv is typically empty.
	const passThroughExecArgv = process.execArgv.filter((arg, idx, arr) => {
		if (arg === "--eval" || arg === "-e") return false;
		if (idx > 0 && (arr[idx - 1] === "--eval" || arr[idx - 1] === "-e")) return false;
		return true;
	});
	const args = [...passThroughExecArgv, process.argv[1], "__daemon-run", "--port", String(port), "--host", host];
	const child = spawn(process.execPath, args, {
		detached: true,
		stdio: ["ignore", out, err],
		env: { ...process.env },
	});
	child.unref();

	if (!child.pid) {
		console.error("Failed to spawn daemon process.");
		process.exit(1);
	}

	const url = `http://${host}:${port}`;
	const ready = await waitForPort(host, port, 10_000);
	if (!ready) {
		console.error(`Daemon did not become ready within 10s. Check logs at ${DAEMON_LOG_PATH}`);
		process.exit(1);
	}

	const state: DaemonState = {
		pid: child.pid,
		host,
		port,
		url,
		startedAt: new Date().toISOString(),
	};
	writeState(state);

	console.log(`overemployed running at ${url} (pid ${child.pid})`);
	console.log(`Logs: ${DAEMON_LOG_PATH}`);
	console.log("Stop with `overemployed stop`.");
}

export async function stopDaemon(): Promise<void> {
	const state = readState();
	if (!state) {
		console.log("overemployed is not running.");
		return;
	}
	if (!isAlive(state.pid)) {
		console.log(`Stale state at ${getStatePath()} (pid ${state.pid} not running). Clearing.`);
		clearState();
		return;
	}

	console.log(`Stopping overemployed (pid ${state.pid})...`);
	try {
		process.kill(state.pid, "SIGTERM");
	} catch (e) {
		console.error(`Failed to send SIGTERM: ${(e as Error).message}`);
		process.exit(1);
	}

	const exited = await waitForExit(state.pid, 12_000);
	if (!exited) {
		console.log("Process did not exit after 12s, sending SIGKILL.");
		try {
			process.kill(state.pid, "SIGKILL");
		} catch {
			// already gone
		}
		await waitForExit(state.pid, 3_000);
	}

	clearState();
	console.log("Stopped.");
}

export async function restartDaemon(options: StartOptions): Promise<void> {
	const existing = readState();
	if (existing && isAlive(existing.pid)) {
		await stopDaemon();
	}
	await startDaemon(options);
}

export function statusDaemon(): void {
	const state = readState();
	if (!state) {
		console.log("overemployed is not running.");
		console.log(`Data dir: ${OVEREMPLOYED_HOME_DIR}`);
		return;
	}
	const alive = isAlive(state.pid);
	if (!alive) {
		console.log(`overemployed is not running (stale state file: ${getStatePath()}).`);
		console.log("Run `overemployed stop` to clear it.");
		return;
	}
	const startedAt = new Date(state.startedAt);
	const uptimeMs = Date.now() - startedAt.getTime();
	console.log(`overemployed is running.`);
	console.log(`  URL:        ${state.url}`);
	console.log(`  PID:        ${state.pid}`);
	console.log(`  Started:    ${startedAt.toISOString()}`);
	console.log(`  Uptime:     ${formatDuration(uptimeMs)}`);
	console.log(`  Data dir:   ${OVEREMPLOYED_HOME_DIR}`);
}

function formatDuration(ms: number): string {
	const sec = Math.floor(ms / 1000);
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = sec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

export function getDaemonLogPath(): string {
	return DAEMON_LOG_PATH;
}
