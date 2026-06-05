import { Hono } from "hono";
import { z } from "zod";
import { recurringAgentCreateRequestSchema, recurringAgentUpdateRequestSchema } from "../../core/api-contract.js";
import { NotFoundError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import {
	createRecurringAgentEntry,
	deleteRecurringAgentEntry,
	getRecurringAgentEntry,
	listRecurringAgentsEntry,
	setRecurringAgentJournalEntry,
	updateRecurringAgentEntry,
} from "../services/recurring-agents-service.js";
import type { AppEnv } from "../types/context.js";

export const recurringAgentsController = new Hono<AppEnv>()
	.get("/", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		return c.json(listRecurringAgentsEntry(workspaceId));
	})
	.get("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		const agent = getRecurringAgentEntry(id);
		if (!agent) throw NotFoundError("Recurring agent");
		return c.json(agent);
	})
	.post("/", zv("json", recurringAgentCreateRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const { workspaceId, ...req } = c.req.valid("json");
		return c.json(createRecurringAgentEntry(workspaceId, req));
	})
	.patch(
		"/:id",
		zv("param", z.object({ id: z.string() })),
		zv("json", recurringAgentUpdateRequestSchema.omit({ id: true })),
		async (c) => {
			const { id } = c.req.valid("param");
			const updated = updateRecurringAgentEntry({ id, ...c.req.valid("json") });
			if (!updated) throw NotFoundError("Recurring agent");
			return c.json(updated);
		},
	)
	// Dedicated journal write — the only mutation a recurring agent can make to itself.
	.post(
		"/:id/journal",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ journal: z.string() })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { journal } = c.req.valid("json");
			const updated = setRecurringAgentJournalEntry(id, journal);
			if (!updated) throw NotFoundError("Recurring agent");
			return c.json(updated);
		},
	)
	// Manual "Run now" — fires the agent immediately without touching its schedule.
	.post(
		"/:id/run",
		zv("param", z.object({ id: z.string() })),
		zv("query", z.object({ workspaceId: z.string() })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { workspaceId } = c.req.valid("query");
			if (!getRecurringAgentEntry(id)) throw NotFoundError("Recurring agent");
			const scheduler = c.get("ctx").getRecurringScheduler(workspaceId);
			const started = (await scheduler?.runNow(id)) ?? false;
			return c.json({ started });
		},
	)
	.delete("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		deleteRecurringAgentEntry(id);
		return c.json({ ok: true });
	});
