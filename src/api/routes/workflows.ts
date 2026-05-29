import { Hono } from "hono";
import { z } from "zod";
import { workflowSchema } from "../../core/api-contract.js";
import { zv } from "../middleware/zv.js";
import {
	deleteWorkflow,
	listWorkflows,
	readPromptFile,
	upsertWorkflow,
	writePromptFile,
} from "../services/workflows-service.js";
import type { AppEnv } from "../types/context.js";

export const workflowsController = new Hono<AppEnv>()
	.get("/", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		return c.json(await listWorkflows(workspaceId));
	})
	.post("/", zv("json", z.object({ workspaceId: z.string(), workflow: workflowSchema })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, workflow } = c.req.valid("json");
		const result = await upsertWorkflow(workspaceId, workflow);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	})
	.delete("/:workflowId", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		const workflowId = c.req.param("workflowId");
		const result = await deleteWorkflow(workspaceId, workflowId);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	})
	.post(
		"/prompt-file",
		zv("json", z.object({ workspaceId: z.string(), path: z.string().min(1), content: z.string() })),
		async (c) => {
			const { workspaceId, path, content } = c.req.valid("json");
			return c.json(await writePromptFile(workspaceId, path, content));
		},
	)
	.get("/prompt-file", zv("query", z.object({ workspaceId: z.string(), path: z.string().min(1) })), async (c) => {
		const { workspaceId, path } = c.req.valid("query");
		return c.json(await readPromptFile(workspaceId, path));
	});
