import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../core/logger.js";

const execFileAsync = promisify(execFile);
const CLOUDFLARED_DIR = join(homedir(), ".cloudflared");

export async function checkCloudflaredInstalled(): Promise<{ installed: boolean; version?: string }> {
	try {
		const { stdout } = await execFileAsync("cloudflared", ["--version"]);
		const version = stdout.trim().split(" ")[2] ?? stdout.trim();
		return { installed: true, version };
	} catch {
		return { installed: false };
	}
}

export async function checkCloudflaredAuth(): Promise<boolean> {
	try {
		await access(join(CLOUDFLARED_DIR, "cert.pem"));
		return true;
	} catch {
		return false;
	}
}

export async function openCloudflaredLogin(force = false): Promise<{ alreadyLoggedIn: boolean; loginUrl?: string }> {
	const alreadyLoggedIn = await checkCloudflaredAuth();
	if (alreadyLoggedIn && !force) return { alreadyLoggedIn: true };
	if (force) {
		try { await unlink(join(CLOUDFLARED_DIR, "cert.pem")); } catch { /* already gone */ }
	}

	return new Promise((resolve) => {
		const proc = spawn("cloudflared", ["tunnel", "login"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buffer = "";
		let resolved = false;

		const tryFindUrl = (chunk: Buffer) => {
			buffer += chunk.toString();
			if (resolved) return;
			const match = buffer.match(/(https:\/\/[^\s\r\n]+)/);
			if (match) {
				resolved = true;
				const loginUrl = match[1].trim();
				logger.info(`[cloudflared-login] Auth URL: ${loginUrl}`);
				spawn("open", [loginUrl], { stdio: "ignore" });
				proc.unref();
				resolve({ alreadyLoggedIn: false, loginUrl });
			}
		};

		proc.stdout.on("data", tryFindUrl);
		proc.stderr.on("data", tryFindUrl);
		proc.on("error", () => { resolved = true; resolve({ alreadyLoggedIn: false }); });

		// After 15s give up waiting for URL
		setTimeout(() => {
			if (!resolved) { resolved = true; proc.unref(); resolve({ alreadyLoggedIn: false }); }
		}, 15000);
	});
}

export async function routeDns(tunnelName: string, hostname: string): Promise<void> {
	const { stdout, stderr } = await execFileAsync("cloudflared", ["tunnel", "route", "dns", tunnelName, hostname]);
	logger.info(`[tunnel-setup] DNS route: ${stdout || stderr}`);
}

async function getTunnelIdByName(tunnelName: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("cloudflared", ["tunnel", "list", "--output", "json"]);
		const tunnels = JSON.parse(stdout) as Array<{ id: string; name: string }>;
		return tunnels.find((t) => t.name === tunnelName)?.id ?? null;
	} catch {
		return null;
	}
}

export async function createTunnel(tunnelName: string): Promise<{ tunnelId: string }> {
	try {
		const { stdout, stderr } = await execFileAsync("cloudflared", ["tunnel", "create", tunnelName]);
		const output = stdout + stderr;
		const match = output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
		if (!match) throw new Error("Could not parse tunnel ID from output");
		return { tunnelId: match[1] };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("already exists")) {
			const tunnelId = await getTunnelIdByName(tunnelName);
			if (tunnelId) return { tunnelId };
		}
		throw new Error(msg);
	}
}

export async function writeTunnelConfig(tunnelId: string, tunnelName: string, domain: string): Promise<void> {
	const credentialsFile = join(CLOUDFLARED_DIR, `${tunnelId}.json`);
	const config = [
		`tunnel: ${tunnelId}`,
		`credentials-file: ${credentialsFile}`,
		``,
		`ingress:`,
		`  - hostname: ${domain}`,
		`    service: http://127.0.0.1:50008`,
		`  - service: http_status:404`,
	].join("\n");

	await mkdir(CLOUDFLARED_DIR, { recursive: true });
	await writeFile(join(CLOUDFLARED_DIR, "config.yml"), config, "utf-8");
	logger.info(`[tunnel-setup] Wrote ~/.cloudflared/config.yml for tunnel ${tunnelName}`);
}

export async function readTunnelConfig(): Promise<{ tunnelId?: string; domain?: string } | null> {
	try {
		const raw = await readFile(join(CLOUDFLARED_DIR, "config.yml"), "utf-8");
		const tunnelMatch = raw.match(/^tunnel:\s*(.+)$/m);
		const hostnameMatch = raw.match(/hostname:\s*(.+)$/m);
		return {
			tunnelId: tunnelMatch?.[1]?.trim(),
			domain: hostnameMatch?.[1]?.trim(),
		};
	} catch {
		return null;
	}
}
