import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

// Header carrying the machine token. Local agent machinery (the MCP server and
// task hooks) presents it instead of a session cookie.
export const MACHINE_TOKEN_HEADER = "x-whipped-token";

// Env var the daemon injects into spawned agent processes so the MCP server and
// hook commands can read the token.
export const MACHINE_TOKEN_ENV = "WHIPPED_API_TOKEN";

// Cached in memory at startup so the per-request check is a constant-time string
// compare with no database/decrypt round-trip on the machinery hot path.
let cached: string | null = null;

export function setMachineToken(token: string): void {
	cached = token;
	// Also expose it on the daemon's own env so spawnAgent (which spreads
	// process.env) carries it to every agent — hook curl commands read it as
	// $WHIPPED_API_TOKEN.
	process.env[MACHINE_TOKEN_ENV] = token;
}

export function getMachineToken(): string | null {
	return cached;
}

export function requestHasMachineToken(req: IncomingMessage): boolean {
	if (!cached) return false;
	const provided = req.headers[MACHINE_TOKEN_HEADER];
	if (typeof provided !== "string") return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(cached);
	return a.length === b.length && timingSafeEqual(a, b);
}
