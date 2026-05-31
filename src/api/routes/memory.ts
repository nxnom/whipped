import { Hono } from "hono";
import { z } from "zod";
import {
	memoryScopeSchema,
	memorySourceTypeSchema,
	memoryStatusSchema,
	memoryTypeSchema,
	runtimeMemoryOriginAgentSchema,
} from "../../core/api-contract.js";
import { BadRequestError, NotFoundError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import {
	approveMemoryEntry,
	createMemoryEntry,
	getMemoryEntry,
	getWorkspaceTagsEntry,
	listMemoryEntries,
	listMemoryEntriesForCard,
	listTagsEntries,
	proposeMemoryEntry,
	proposeMemoryEntryUpdate,
	removeMemoryEntry,
	searchMemoryEntries,
	setMemoryBindingsEntry,
	setMemoryTagsEntry,
	setWorkspaceTagsEntry,
	updateMemoryEntry,
} from "../services/memory-service.js";
import type { AppEnv } from "../types/context.js";

export const memoryController = new Hono<AppEnv>()
	// scope='project' requires workspaceId; scope='global' ignores it.
	.get(
		"/",
		zv(
			"query",
			z.object({
				scope: memoryScopeSchema,
				workspaceId: z.string().optional(),
				status: memoryStatusSchema.optional(),
			}),
		),
		async (c) => {
			const input = c.req.valid("query");
			return c.json(
				await listMemoryEntries({
					scope: input.scope,
					workspaceId: input.scope === "project" ? input.workspaceId : null,
					status: input.status,
				}),
			);
		},
	)
	.get("/search", zv("query", z.object({ query: z.string(), workspaceId: z.string().optional() })), async (c) => {
		const input = c.req.valid("query");
		return c.json(await searchMemoryEntries(input.query, input.workspaceId ?? null));
	})
	.get("/for-card", zv("query", z.object({ cardId: z.string() })), async (c) => {
		const input = c.req.valid("query");
		return c.json(await listMemoryEntriesForCard(input.cardId));
	})
	// Canonical tag vocabulary (reuse-first). Must precede "/:id".
	.get("/tags", async (c) => c.json(await listTagsEntries()))
	// A workspace's subscribed tags. Must precede "/:id".
	.get("/workspace-tags", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		return c.json(await getWorkspaceTagsEntry(workspaceId));
	})
	.get("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		return c.json(await getMemoryEntry(id));
	})
	// Agent-facing create. Status decided by the auto-approve policy.
	// source_type defaults to task_lesson (what a dev agent typically records).
	.post(
		"/propose",
		zv(
			"json",
			z.object({
				scope: memoryScopeSchema,
				workspaceId: z.string().optional(),
				originWorkspaceId: z.string().optional(),
				type: memoryTypeSchema,
				title: z.string().min(1),
				content: z.string().min(1),
				sourceType: memorySourceTypeSchema.default("task_lesson"),
				importance: z.number().int().min(1).max(3).optional(),
				tags: z.array(z.string()).optional(),
				originCardId: z.string().optional(),
				originAgent: runtimeMemoryOriginAgentSchema.optional(),
			}),
		),
		async (c) => {
			const input = c.req.valid("json");
			if (input.scope === "project" && !input.workspaceId) {
				throw BadRequestError("project memory requires a workspaceId");
			}
			if (input.scope === "global" && (input.tags?.length ?? 0) === 0) {
				throw BadRequestError("global memory requires at least one tag");
			}
			return c.json(
				await proposeMemoryEntry({
					scope: input.scope,
					workspaceId: input.scope === "project" ? input.workspaceId : null,
					originWorkspaceId: input.originWorkspaceId ?? input.workspaceId ?? null,
					type: input.type,
					title: input.title,
					content: input.content,
					sourceType: input.sourceType,
					importance: input.importance,
					tags: input.tags,
					originCardId: input.originCardId ?? null,
					originAgent: input.originAgent ?? null,
				}),
			);
		},
	)
	// Agent-facing update of an existing memory. Same approval policy as propose.
	.post(
		"/propose-update",
		zv(
			"json",
			z.object({
				id: z.string(),
				type: memoryTypeSchema.optional(),
				title: z.string().min(1).optional(),
				content: z.string().min(1).optional(),
				importance: z.number().int().min(1).max(3).optional(),
				sourceType: memorySourceTypeSchema.default("task_lesson"),
			}),
		),
		async (c) => {
			const { id, sourceType, ...patch } = c.req.valid("json");
			const updated = await proposeMemoryEntryUpdate(id, patch, sourceType);
			if (!updated) throw NotFoundError("Memory");
			return c.json(updated);
		},
	)
	// Human-authored memories are created already approved.
	.post(
		"/",
		zv(
			"json",
			z.object({
				scope: memoryScopeSchema,
				workspaceId: z.string().optional(),
				originWorkspaceId: z.string().optional(),
				type: memoryTypeSchema,
				title: z.string().min(1),
				content: z.string().min(1),
				importance: z.number().int().min(1).max(3).optional(),
				tags: z.array(z.string()).optional(),
				boundWorkspaceIds: z.array(z.string()).optional(),
			}),
		),
		async (c) => {
			const input = c.req.valid("json");
			if (input.scope === "project" && !input.workspaceId) {
				throw BadRequestError("project memory requires a workspaceId");
			}
			if (input.scope === "global" && (input.tags?.length ?? 0) === 0) {
				throw BadRequestError("global memory requires at least one tag");
			}
			return c.json(
				await createMemoryEntry({
					scope: input.scope,
					workspaceId: input.scope === "project" ? input.workspaceId : null,
					originWorkspaceId: input.originWorkspaceId ?? input.workspaceId ?? null,
					type: input.type,
					title: input.title,
					content: input.content,
					sourceType: "manual_human",
					importance: input.importance,
					tags: input.tags,
					boundWorkspaceIds: input.boundWorkspaceIds,
					status: "approved",
				}),
			);
		},
	)
	.patch(
		"/:id",
		zv("param", z.object({ id: z.string() })),
		zv(
			"json",
			z.object({
				type: memoryTypeSchema.optional(),
				title: z.string().min(1).optional(),
				content: z.string().min(1).optional(),
				importance: z.number().int().min(1).max(3).optional(),
			}),
		),
		async (c) => {
			const { id } = c.req.valid("param");
			const updated = await updateMemoryEntry(id, c.req.valid("json"));
			if (!updated) throw NotFoundError("Memory");
			return c.json(updated);
		},
	)
	.post("/:id/approve", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		const approved = await approveMemoryEntry(id);
		if (!approved) throw NotFoundError("Memory");
		return c.json(approved);
	})
	.delete("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		await removeMemoryEntry(id);
		return c.json({ ok: true });
	})
	// Set a memory's tags (human curation).
	.patch(
		"/:id/tags",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ tags: z.array(z.string()) })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { tags } = c.req.valid("json");
			const updated = await setMemoryTagsEntry(id, tags);
			if (!updated) throw NotFoundError("Memory");
			return c.json(updated);
		},
	)
	// Bind a global memory to specific workspaces by id (human curation).
	.patch(
		"/:id/bindings",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ workspaceIds: z.array(z.string()) })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { workspaceIds } = c.req.valid("json");
			const updated = await setMemoryBindingsEntry(id, workspaceIds);
			if (!updated) throw NotFoundError("Memory");
			return c.json(updated);
		},
	)
	// Set a workspace's subscribed tags (human curation in project settings).
	.put("/workspace-tags", zv("json", z.object({ workspaceId: z.string(), tags: z.array(z.string()) })), async (c) => {
		const { workspaceId, tags } = c.req.valid("json");
		await setWorkspaceTagsEntry(workspaceId, tags);
		return c.json({ ok: true });
	});
