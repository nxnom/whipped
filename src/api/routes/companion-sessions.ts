import { Hono } from "hono";
import { z } from "zod";
import { companionSessionCreateRequestSchema } from "../../core/api-contract.js";
import { NotFoundError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import {
	getCompanionCommitsService,
	getCompanionDiffForCommitService,
	getCompanionDiffService,
} from "../services/companion-diff-service.js";
import { commitAndMergeCompanionService, commitAndPRCompanionService } from "../services/companion-merge-service.js";
import {
	createCompanionSessionEntry,
	discardCompanionSessionEntry,
	getCompanionSessionEntry,
	listCompanionSessionsEntry,
	stopCompanionSessionEntry,
} from "../services/companion-service.js";
import type { AppEnv } from "../types/context.js";

export const companionSessionsController = new Hono<AppEnv>()
	.get("/", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		return c.json(await listCompanionSessionsEntry(workspaceId));
	})
	.get("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		const session = getCompanionSessionEntry(id);
		if (!session) throw NotFoundError("Companion session");
		return c.json(session);
	})
	.post("/", zv("json", companionSessionCreateRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, ...req } = c.req.valid("json");
		const ws = await ctx.ensureWorkspace(workspaceId);
		const scheduler = ctx.getScheduler(workspaceId);
		if (!scheduler) throw NotFoundError("Workspace");
		const session = await createCompanionSessionEntry(workspaceId, ws.repoPath, req, scheduler);
		return c.json(session);
	})
	.delete(
		"/:id",
		zv("param", z.object({ id: z.string() })),
		zv("query", z.object({ workspaceId: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { id } = c.req.valid("param");
			const { workspaceId } = c.req.valid("query");
			await stopCompanionSessionEntry(id, ctx.getScheduler(workspaceId));
			return c.json({ ok: true });
		},
	)
	.post(
		"/:id/discard",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ workspaceId: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { id } = c.req.valid("param");
			const { workspaceId } = c.req.valid("json");
			const ws = await ctx.ensureWorkspace(workspaceId);
			await discardCompanionSessionEntry(id, ws.repoPath, ctx.getScheduler(workspaceId));
			return c.json({ ok: true });
		},
	)
	.get("/:id/diff", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		return c.json(await getCompanionDiffService(id));
	})
	.get("/:id/commits", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		return c.json(await getCompanionCommitsService(id));
	})
	.get(
		"/:id/diff-for-commit",
		zv("param", z.object({ id: z.string() })),
		zv("query", z.object({ commitHash: z.string() })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { commitHash } = c.req.valid("query");
			return c.json(await getCompanionDiffForCommitService(id, commitHash));
		},
	)
	.post(
		"/:id/commit-and-merge",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ workspaceId: z.string(), commitMessage: z.string().optional() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { id } = c.req.valid("param");
			const { workspaceId, commitMessage } = c.req.valid("json");
			const ws = await ctx.ensureWorkspace(workspaceId);
			const result = await commitAndMergeCompanionService(
				id,
				ws.repoPath,
				commitMessage,
				ctx.getScheduler(workspaceId),
			);
			return c.json(result);
		},
	)
	.post(
		"/:id/commit-and-pr",
		zv("param", z.object({ id: z.string() })),
		zv(
			"json",
			z.object({
				workspaceId: z.string(),
				commitMessage: z.string().optional(),
				title: z.string(),
				description: z.string(),
				baseRef: z.string().optional(),
			}),
		),
		async (c) => {
			const { id } = c.req.valid("param");
			const { workspaceId, commitMessage, title, description, baseRef } = c.req.valid("json");
			const result = await commitAndPRCompanionService(id, workspaceId, commitMessage, title, description, baseRef);
			return c.json(result);
		},
	);
