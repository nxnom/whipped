import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import { listAvailableAgents, listModels } from "../services/agents-service.js";
import type { AppEnv } from "../types/context.js";

export const agentsController = new Hono<AppEnv>()
	.get("/available", async (c) => {
		return c.json(await listAvailableAgents());
	})
	.get("/models", zv("query", z.object({ agent: z.enum(["opencode", "cursor", "mimo"]) })), async (c) => {
		return c.json(await listModels(c.req.valid("query").agent));
	});
