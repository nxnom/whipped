import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { OVEREMPLOYED_HOME_DIR } from "../config/runtime-config.js";

export interface DaemonState {
	pid: number;
	host: string;
	port: number;
	url: string;
	startedAt: string;
}

const STATE_PATH = join(OVEREMPLOYED_HOME_DIR, "daemon.pid");

export function getStatePath(): string {
	return STATE_PATH;
}

export function readState(): DaemonState | null {
	if (!existsSync(STATE_PATH)) return null;
	try {
		const parsed = JSON.parse(readFileSync(STATE_PATH, "utf-8")) as DaemonState;
		if (typeof parsed.pid !== "number") return null;
		return parsed;
	} catch {
		return null;
	}
}

export function writeState(state: DaemonState): void {
	mkdirSync(OVEREMPLOYED_HOME_DIR, { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function clearState(): void {
	try {
		unlinkSync(STATE_PATH);
	} catch {
		// already gone
	}
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "EPERM";
	}
}

export async function waitForPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const ok = await new Promise<boolean>((resolve) => {
			const socket = connect({ host, port });
			const done = (v: boolean) => {
				socket.destroy();
				resolve(v);
			};
			socket.once("connect", () => done(true));
			socket.once("error", () => done(false));
			socket.setTimeout(500, () => done(false));
		});
		if (ok) return true;
		await new Promise((r) => setTimeout(r, 150));
	}
	return false;
}

export async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return true;
		await new Promise((r) => setTimeout(r, 150));
	}
	return false;
}
