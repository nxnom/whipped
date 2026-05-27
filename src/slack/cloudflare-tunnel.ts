import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../core/logger.js";

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface TunnelState {
	status: TunnelStatus;
	error?: string;
	pid?: number;
}

class CloudflareTunnelManager {
	private process: ChildProcess | null = null;
	private state: TunnelState = { status: "stopped" };
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false; // true when manually stopped — suppresses auto-restart

	getState(): TunnelState {
		return { ...this.state };
	}

	start(): void {
		if (this.process) return;
		this.stopped = false;
		this._spawn();
	}

	stop(): void {
		this.stopped = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.state = { status: "stopped" };
		logger.info("[tunnel] Stopped");
	}

	private _spawn(): void {
		this.state = { status: "starting" };
		logger.info("[tunnel] Starting cloudflared tunnel run overemployed");

		const proc = spawn("cloudflared", ["tunnel", "run", "overemployed"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.process = proc;

		proc.stdout?.on("data", (data: Buffer) => {
			const line = data.toString();
			if (line.includes("Registered tunnel connection")) {
				this.state = { status: "running", pid: proc.pid };
				logger.info("[tunnel] Connected");
			}
		});

		proc.stderr?.on("data", (data: Buffer) => {
			const line = data.toString();
			if (line.includes("Registered tunnel connection")) {
				this.state = { status: "running", pid: proc.pid };
				logger.info("[tunnel] Connected");
			}
		});

		proc.on("error", (err) => {
			logger.warn({ err }, "[tunnel] Failed to spawn cloudflared — is it installed?");
			this.process = null;
			this.state = { status: "error", error: "cloudflared not found — run: brew install cloudflared" };
		});

		proc.on("exit", (code) => {
			this.process = null;
			if (this.stopped) return;
			logger.warn(`[tunnel] Exited with code ${code}, restarting in 5s`);
			this.state = { status: "error", error: `Exited with code ${code}` };
			this.restartTimer = setTimeout(() => {
				if (!this.stopped) this._spawn();
			}, 5000);
		});
	}
}

export const tunnelManager = new CloudflareTunnelManager();
