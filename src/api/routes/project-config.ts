import { Hono } from "hono";
import { z } from "zod";
import { runtimeProjectConfigSchema } from "../../core/api-contract.js";
import { zv } from "../middleware/zv.js";
import {
	getProjectConfig,
	saveProjectConfig,
	setGitInstructions,
	setPreviewUrl,
	setSystemPrompt,
} from "../services/project-config-service.js";
import type { AppEnv } from "../types/context.js";

export const projectConfigController = new Hono<AppEnv>()
	.get("/", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		return c.json(await getProjectConfig(c.req.valid("query").workspaceId));
	})
	.put("/", zv("json", z.object({ workspaceId: z.string(), config: runtimeProjectConfigSchema })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, config } = c.req.valid("json");
		await saveProjectConfig(workspaceId, config);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true });
	})
	.post("/git-instructions", zv("json", z.object({ workspaceId: z.string(), instructions: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, instructions } = c.req.valid("json");
		const { cleared } = await setGitInstructions(workspaceId, instructions);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true, cleared });
	})
	.post("/system-prompt", zv("json", z.object({ workspaceId: z.string(), prompt: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, prompt } = c.req.valid("json");
		const { cleared } = await setSystemPrompt(workspaceId, prompt);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true, cleared });
	})
	.post("/preview-url", zv("json", z.object({ workspaceId: z.string(), url: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, url } = c.req.valid("json");
		const { cleared } = await setPreviewUrl(workspaceId, url);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true, cleared });
	});
