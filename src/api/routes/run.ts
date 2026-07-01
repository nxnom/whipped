import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError, PreconditionFailedError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import { resolveCardCwd, resolveCompanionSessionCwd, resolveStartCommand } from "../services/run-service.js";
import type { AppEnv } from "../types/context.js";

export const runController = new Hono<AppEnv>()
	.get("/status", zv("query", z.object({ workspaceId: z.string() })), (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		const session = ctx.getRunSession(workspaceId);
		if (!session) return c.json({ cardId: null, status: "stopped" as const, errorMessage: undefined });
		return c.json({ cardId: session.cardId, status: session.status, errorMessage: session.errorMessage });
	})
	.post("/start", zv("json", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, cardId } = c.req.valid("json");
		const ws = await ctx.ensureWorkspace(workspaceId);
		const command = await resolveStartCommand(workspaceId);
		if (!command) {
			throw PreconditionFailedError("No start command configured. Add one in Settings → Environment.");
		}
		const cwd = await resolveCardCwd(workspaceId, cardId, ws.repoPath);
		if (cwd === null) throw NotFoundError("Card");
		ctx.startRun(workspaceId, cardId, command, cwd);
		return c.json({ ok: true });
	})
	.post("/start-companion", zv("json", z.object({ workspaceId: z.string(), sessionId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, sessionId } = c.req.valid("json");
		const command = await resolveStartCommand(workspaceId);
		if (!command) {
			throw PreconditionFailedError("No start command configured. Add one in Settings → Environment.");
		}
		const cwd = resolveCompanionSessionCwd(sessionId);
		if (cwd === null) throw NotFoundError("Companion session");
		ctx.startRun(workspaceId, sessionId, command, cwd);
		return c.json({ ok: true });
	})
	.post("/start-base", zv("json", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("json");
		const ws = await ctx.ensureWorkspace(workspaceId);
		const command = await resolveStartCommand(workspaceId);
		if (!command) {
			throw PreconditionFailedError("No start command configured. Add one in Settings → Environment.");
		}
		ctx.startRun(workspaceId, null, command, ws.repoPath);
		return c.json({ ok: true });
	})
	.post("/stop", zv("json", z.object({ workspaceId: z.string() })), (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("json");
		ctx.stopRun(workspaceId);
		return c.json({ ok: true });
	});
