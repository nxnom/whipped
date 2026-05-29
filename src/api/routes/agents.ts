import { Hono } from "hono";
import { listAvailableAgents, listCursorModels, listOpencodeModels } from "../services/agents-service.js";
import type { AppEnv } from "../types/context.js";

export const agentsController = new Hono<AppEnv>()
	.get("/available", async (c) => {
		return c.json(await listAvailableAgents());
	})
	.get("/opencode-models", async (c) => {
		return c.json(await listOpencodeModels());
	})
	.get("/cursor-models", async (c) => {
		return c.json(await listCursorModels());
	});
