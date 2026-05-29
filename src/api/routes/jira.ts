import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError, PreconditionFailedError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import { fetchJiraTickets, importJiraTickets } from "../services/jira-service.js";
import type { AppEnv } from "../types/context.js";

export const jiraController = new Hono<AppEnv>()
	.get("/tickets", zv("query", z.object({ workspaceId: z.string() })), async (c) => {
		const { workspaceId } = c.req.valid("query");
		const tickets = await fetchJiraTickets(workspaceId);
		if (!tickets) throw PreconditionFailedError("Jira not configured for this project");
		return c.json(tickets);
	})
	.post("/import", zv("json", z.object({ workspaceId: z.string(), ticketKeys: z.array(z.string()) })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, ticketKeys } = c.req.valid("json");
		const result = await importJiraTickets(workspaceId, ticketKeys);
		if ("error" in result) {
			if (result.error === "not_configured") throw PreconditionFailedError("Jira not configured for this project");
			throw NotFoundError("Workspace");
		}
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	});
