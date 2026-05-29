import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { WHIPPED_HOME_DIR } from "../config/runtime-config.js";
import { forceReleaseInstanceLock, isInstanceRunning } from "../state/instance-lock.js";
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

const DAEMON_LOG_DIR = join(WHIPPED_HOME_DIR, "logs");
const DAEMON_LOG_PATH = join(DAEMON_LOG_DIR, "daemon.log");

interface StartOptions {
	port: number;
	host: string;
}

export async function startDaemon(options: StartOptions): Promise<void> {
	const { port, host } = options;
	// Authoritative running check is the db lock, not pid liveness (which a recycled
	// pid can fool). daemon.pid is only read for the URL/pid to display.
	if (await isInstanceRunning()) {
		const existing = readState();
		console.log(`whipped is already running${existing ? ` at ${existing.url} (pid ${existing.pid})` : ""}`);
		console.log("Use `whipped restart` to restart, or `whipped stop` to stop.");
		return;
	}
	if (readState()) clearState();

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

	console.log(`whipped running at ${url} (pid ${child.pid})`);
	console.log(`Logs: ${DAEMON_LOG_PATH}`);
	console.log("Stop with `whipped stop`.");
}

export async function stopDaemon(): Promise<void> {
	const state = readState();
	if (!state) {
		console.log("whipped is not running.");
		return;
	}
	if (!isAlive(state.pid)) {
		console.log(`Stale state at ${getStatePath()} (pid ${state.pid} not running). Clearing.`);
		forceReleaseInstanceLock();
		clearState();
		return;
	}

	console.log(`Stopping whipped (pid ${state.pid})...`);
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

	// Owner is dead — drop its lock now rather than waiting for the stale timeout, so a
	// follow-on start (e.g. `whipped restart`) isn't blocked by a SIGKILLed owner's lock.
	forceReleaseInstanceLock();
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
		console.log("whipped is not running.");
		console.log(`Data dir: ${WHIPPED_HOME_DIR}`);
		return;
	}
	const alive = isAlive(state.pid);
	if (!alive) {
		console.log(`whipped is not running (stale state file: ${getStatePath()}).`);
		console.log("Run `whipped stop` to clear it.");
		return;
	}
	const startedAt = new Date(state.startedAt);
	const uptimeMs = Date.now() - startedAt.getTime();
	console.log(`whipped is running.`);
	console.log(`  URL:        ${state.url}`);
	console.log(`  PID:        ${state.pid}`);
	console.log(`  Started:    ${startedAt.toISOString()}`);
	console.log(`  Uptime:     ${formatDuration(uptimeMs)}`);
	console.log(`  Data dir:   ${WHIPPED_HOME_DIR}`);
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
