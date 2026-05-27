import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../core/logger.js";

const execFileAsync = promisify(execFile);

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface TunnelState {
	status: TunnelStatus;
	publicUrl?: string;
	error?: string;
}

// Resolves the public Tailscale Funnel URL for this machine.
// Returns undefined if tailscale is not installed or not logged in.
export async function getTailscalePublicUrl(): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
		const status = JSON.parse(stdout) as { Self?: { DNSName?: string } };
		const dnsName = status.Self?.DNSName;
		if (!dnsName) return undefined;
		// DNSName has a trailing dot: "hostname.tailnet.ts.net."
		const host = dnsName.replace(/\.$/, "");
		return `https://${host}`;
	} catch {
		return undefined;
	}
}

const BACKEND_PORT = 50008;

class TailscaleFunnelManager {
	private process: ChildProcess | null = null;
	private state: TunnelState = { status: "stopped" };
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	getState(): TunnelState {
		return { ...this.state };
	}

	async start(): Promise<void> {
		if (this.process) return;
		this.stopped = false;
		const url = await getTailscalePublicUrl();
		this._spawn(url);
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

	private _spawn(publicUrl: string | undefined): void {
		this.state = { status: "starting", publicUrl };
		logger.info(`[tunnel] Starting tailscale funnel ${BACKEND_PORT}`);

		const proc = spawn("tailscale", ["funnel", String(BACKEND_PORT)], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.process = proc;

		const onData = (data: Buffer) => {
			const line = data.toString();
			logger.debug(`[tunnel] ${line.trim()}`);
			// tailscale funnel prints the URL when ready
			if (line.includes("https://") || line.includes("Available on the internet")) {
				const match = line.match(/https:\/\/[^\s]+/);
				const detectedUrl = match?.[0] ?? publicUrl;
				this.state = { status: "running", publicUrl: detectedUrl };
				logger.info(`[tunnel] Running at ${detectedUrl}`);
			}
		};

		proc.stdout?.on("data", onData);
		proc.stderr?.on("data", onData);

		// tailscale funnel may not print anything but still work — mark running after 3s
		const fallbackTimer = setTimeout(() => {
			if (this.state.status === "starting") {
				this.state = { status: "running", publicUrl };
				logger.info("[tunnel] Running (assumed ready)");
			}
		}, 3000);

		proc.on("error", (err) => {
			clearTimeout(fallbackTimer);
			logger.warn({ err }, "[tunnel] Failed to spawn tailscale — is it installed?");
			this.process = null;
			this.state = { status: "error", error: "tailscale not found — run: brew install tailscale" };
		});

		proc.on("exit", (code) => {
			clearTimeout(fallbackTimer);
			this.process = null;
			if (this.stopped) return;
			logger.warn(`[tunnel] Exited with code ${code}, restarting in 5s`);
			this.state = { status: "error", error: `Exited with code ${code}` };
			this.restartTimer = setTimeout(() => {
				if (!this.stopped) void this.start();
			}, 5000);
		});
	}
}

export const tunnelManager = new TailscaleFunnelManager();
