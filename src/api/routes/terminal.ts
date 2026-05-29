import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import { toBufferResponse } from "../services/terminal-service.js";
import type { AppEnv } from "../types/context.js";

export const terminalController = new Hono<AppEnv>()
	.get("/buffer", zv("query", z.object({ workspaceId: z.string(), taskId: z.string() })), (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, taskId } = c.req.valid("query");
		const buf = ctx.getScheduler(workspaceId)?.getOutputBuffer(taskId);
		return c.json(toBufferResponse(buf));
	})
	.post(
		"/resize",
		zv("json", z.object({ workspaceId: z.string(), taskId: z.string(), cols: z.number(), rows: z.number() })),
		(c) => {
			const ctx = c.var.ctx;
			const { workspaceId, taskId, cols, rows } = c.req.valid("json");
			ctx.getScheduler(workspaceId)?.resizeTerminal(taskId, cols, rows);
			return c.json({ ok: true });
		},
	)
	.post("/input", zv("json", z.object({ workspaceId: z.string(), taskId: z.string(), data: z.string() })), (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, taskId, data } = c.req.valid("json");
		ctx.getScheduler(workspaceId)?.writeToTerminal(taskId, data);
		return c.json({ ok: true });
	});
