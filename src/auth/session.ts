import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "whipped_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Bumping this invalidates every previously issued cookie without rotating the
// signing secret — an alternative "log everyone out" lever.
const SESSION_VERSION = 1;

interface SessionPayload {
	v: number;
	exp: number;
}

// Stateless signed token: base64url(payload).base64url(hmac). No server-side
// session store — validity is proven by the signature and the embedded expiry.
export function signSession(secret: string, ttlSeconds = SESSION_TTL_SECONDS): string {
	const payload: SessionPayload = { v: SESSION_VERSION, exp: Date.now() + ttlSeconds * 1000 };
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const sig = createHmac("sha256", secret).update(body).digest("base64url");
	return `${body}.${sig}`;
}

export function verifySession(secret: string, token: string): boolean {
	const dot = token.lastIndexOf(".");
	if (dot <= 0) return false;
	const body = token.slice(0, dot);
	const expected = createHmac("sha256", secret).update(body).digest("base64url");
	const sigBuf = Buffer.from(token.slice(dot + 1));
	const expBuf = Buffer.from(expected);
	if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;
	try {
		const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
		return payload.v === SESSION_VERSION && typeof payload.exp === "number" && payload.exp > Date.now();
	} catch {
		return false;
	}
}
