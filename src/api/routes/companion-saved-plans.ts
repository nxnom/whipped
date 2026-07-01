import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import {
	deleteCompanionSavedPlanEntry,
	listCompanionSavedPlansEntry,
} from "../services/companion-saved-plans-service.js";
import type { AppEnv } from "../types/context.js";

export const companionSavedPlansController = new Hono<AppEnv>()
	.get("/", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		return c.json(await listCompanionSavedPlansEntry(workspaceId));
	})
	.delete("/:id", zv("param", z.object({ id: z.string() })), async (c) => {
		const { id } = c.req.valid("param");
		await deleteCompanionSavedPlanEntry(id);
		return c.json({ ok: true });
	});
