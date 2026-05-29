import { Hono } from "hono";
import { z } from "zod";
import { runtimeWorkspaceStateSaveRequestSchema } from "../../core/api-contract.js";
import { BadRequestError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import {
	listRootFiles,
	loadStateForContext,
	loadStateForWorkspace,
	saveState,
	updateAutonomousMode,
} from "../services/workspace-service.js";
import type { AppEnv } from "../types/context.js";

export const workspaceController = new Hono<AppEnv>()
	.get("/state", zv("query", z.object({ workspaceId: z.string().optional() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		if (workspaceId) {
			return c.json(await loadStateForWorkspace(workspaceId));
		}
		if (!ctx.currentWorkspaceId || !ctx.currentRepoPath) throw BadRequestError("No workspace context");
		return c.json(await loadStateForContext(ctx.currentWorkspaceId, ctx.currentRepoPath));
	})
	.post("/save", zv("json", runtimeWorkspaceStateSaveRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const { workspaceId, board, revision } = c.req.valid("json");
		return c.json(await saveState(workspaceId, { board, revision }));
	})
	.post("/autonomous-mode", zv("json", z.object({ workspaceId: z.string(), enabled: z.boolean() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, enabled } = c.req.valid("json");
		await updateAutonomousMode(workspaceId, enabled);
		const poller = ctx.getPoller(workspaceId);
		if (enabled) {
			poller?.start();
		} else {
			poller?.stop();
		}
		ctx.stateHub.broadcastAutonomousModeChange(workspaceId, enabled);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true });
	})
	.get("/root-files", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("query");
		const ws = await ctx.ensureWorkspace(workspaceId);
		return c.json(listRootFiles(ws.repoPath));
	});
