import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
	getOrCreateSessionSecret,
	getPasswordHash,
	getSessionSecret,
	isPasswordSet,
	setPasswordHash,
} from "../../auth/auth-store.js";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import { LOCAL_REQUEST_HEADER } from "../../auth/request-auth.js";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, signSession, verifySession } from "../../auth/session.js";
import { passwordCredentialsSchema } from "../../core/validation/auth.js";
import { ForbiddenError, UnauthorizedError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import type { AppEnv } from "../types/context.js";

async function issueSession(c: Context<AppEnv>): Promise<void> {
	const secret = await getOrCreateSessionSecret();
	setCookie(c, SESSION_COOKIE_NAME, signSession(secret), {
		httpOnly: true,
		secure: true,
		sameSite: "None",
		path: "/",
		maxAge: SESSION_TTL_SECONDS,
	});
}

export const authController = new Hono<AppEnv>()
	// Public probe driving the login/setup UI: is a password configured, and is
	// this caller already authenticated?
	.get("/status", async (c) => {
		const token = getCookie(c, SESSION_COOKIE_NAME);
		const secret = await getSessionSecret();
		return c.json({
			needsSetup: !(await isPasswordSet()),
			authenticated: Boolean(token && secret && verifySession(secret, token)),
		});
	})
	// First-run: set the initial password. Allowed only from the local machine and
	// only while none exists, so a tunnel visitor can never claim the daemon.
	.post("/setup", zv("json", passwordCredentialsSchema), async (c) => {
		if (c.req.header(LOCAL_REQUEST_HEADER) !== "1") {
			throw ForbiddenError("Initial setup must be performed from the local machine");
		}
		if (await isPasswordSet()) {
			throw ForbiddenError("A password is already set");
		}
		await setPasswordHash(hashPassword(c.req.valid("json").password));
		await issueSession(c);
		return c.json({ ok: true });
	})
	.post("/login", zv("json", passwordCredentialsSchema), async (c) => {
		const stored = await getPasswordHash();
		if (!stored || !verifyPassword(c.req.valid("json").password, stored)) {
			throw UnauthorizedError("Invalid password");
		}
		await issueSession(c);
		return c.json({ ok: true });
	})
	.post("/logout", (c) => {
		deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
		return c.json({ ok: true });
	});
