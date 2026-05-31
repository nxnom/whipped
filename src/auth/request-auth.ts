import type { IncomingMessage } from "node:http";
import { getSessionSecret } from "./auth-store.js";
import { SESSION_COOKIE_NAME, verifySession } from "./session.js";

// Header the raw HTTP layer injects (after stripping any client-supplied value)
// so Hono controllers can tell whether a request originated locally — the socket
// is not available once a request is handed to apiApp.fetch().
export const LOCAL_REQUEST_HEADER = "x-whipped-local";

export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
	}
	return undefined;
}

export async function isRequestAuthenticated(req: IncomingMessage): Promise<boolean> {
	const secret = await getSessionSecret();
	if (!secret) return false;
	const token = parseCookieHeader(req.headers.cookie, SESSION_COOKIE_NAME);
	return Boolean(token && verifySession(secret, token));
}

// A genuinely-local request: loopback peer AND no proxy/tunnel forwarding
// headers. Cloudflare Tunnel and Tailscale serve both connect to loopback but
// always inject these headers, so a tunneled (remote) request never looks local.
export function isLocalRequest(req: IncomingMessage): boolean {
	const remote = req.socket.remoteAddress ?? "";
	const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
	if (!loopback) return false;
	const forwarded =
		req.headers["x-forwarded-for"] ??
		req.headers["cf-connecting-ip"] ??
		req.headers["cf-ray"] ??
		req.headers["x-forwarded-host"];
	return !forwarded;
}
