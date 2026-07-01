import { Hono } from "hono";
import { z } from "zod";
import { agentModelChoiceSchema } from "../../core/api-contract.js";
import { NotFoundError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import { getAgentSessionStatus, startAgentSession, stopAgentSession } from "../services/agent-service.js";
import type { AppEnv } from "../types/context.js";

const startSessionBodySchema = z.object({
	workspaceId: z.string(),
	override: agentModelChoiceSchema.optional(),
	savedPlanId: z.string().optional(),
});

export const agentController = new Hono<AppEnv>()
	.get("/session", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		return c.json(await getAgentSessionStatus(ctx.getScheduler(workspaceId)));
	})
	.post("/session", zv("json", startSessionBodySchema), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, override, savedPlanId } = c.req.valid("json");
		const scheduler = ctx.getScheduler(workspaceId);
		if (!scheduler) {
			await ctx.ensureWorkspace(workspaceId);
			const retried = ctx.getScheduler(workspaceId);
			if (!retried) throw NotFoundError("Workspace");
			return c.json(await startAgentSession(retried, override, savedPlanId));
		}
		return c.json(await startAgentSession(scheduler, override, savedPlanId));
	})
	.delete("/session", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		await stopAgentSession(ctx.getScheduler(workspaceId));
		return c.json({ ok: true });
	});
