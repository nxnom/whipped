import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import { getAgentSessionStatus, startAgentSession, stopAgentSession } from "../services/agent-service.js";
import type { AppEnv } from "../types/context.js";

export const agentController = new Hono<AppEnv>()
	.get("/session", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		return c.json(await getAgentSessionStatus(ctx.getScheduler(workspaceId)));
	})
	.post("/session", zv("json", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("json");
		const scheduler = ctx.getScheduler(workspaceId);
		if (!scheduler) {
			await ctx.ensureWorkspace(workspaceId);
			const retried = ctx.getScheduler(workspaceId);
			if (!retried) throw NotFoundError("Workspace");
			return c.json(await startAgentSession(retried));
		}
		return c.json(await startAgentSession(scheduler));
	})
	.delete("/session", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		await stopAgentSession(ctx.getScheduler(workspaceId));
		return c.json({ ok: true });
	});
