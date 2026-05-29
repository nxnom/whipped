import { Hono } from "hono";
import { z } from "zod";
import { projectsLayoutSchema, runtimeProjectConfigSchema } from "../../core/api-contract.js";
import { zv } from "../middleware/zv.js";
import {
	addProject,
	checkProjectPath,
	getProjectsLayout,
	listProjects,
	removeProject,
	saveProjectsLayoutData,
} from "../services/projects-service.js";
import type { AppEnv } from "../types/context.js";

export const projectsController = new Hono<AppEnv>()
	.get("/", async (c) => {
		return c.json(await listProjects());
	})
	.get("/layout", (c) => {
		return c.json(getProjectsLayout());
	})
	.get("/check-path", zv("query", z.object({ repoPath: z.string() })), async (c) => {
		return c.json(await checkProjectPath(c.req.valid("query").repoPath));
	})
	.post(
		"/",
		zv(
			"json",
			z.object({
				repoPath: z.string().min(1),
				initialConfig: runtimeProjectConfigSchema.partial().optional(),
			}),
		),
		async (c) => {
			const ctx = c.var.ctx;
			const { repoPath, initialConfig } = c.req.valid("json");
			const context = await addProject(repoPath, initialConfig);
			await ctx.ensureWorkspace(context.workspaceId);
			return c.json(context);
		},
	)
	.put("/layout", zv("json", projectsLayoutSchema), (c) => {
		return c.json(saveProjectsLayoutData(c.req.valid("json")));
	})
	.delete("/:workspaceId", async (c) => {
		const ctx = c.var.ctx;
		const workspaceId = c.req.param("workspaceId");

		// Stop all running agents and the run session (ctx-bound work stays here).
		const scheduler = ctx.getScheduler(workspaceId);
		if (scheduler) {
			scheduler.prepareShutdown();
			scheduler.stopAll();
		}
		ctx.stopRun(workspaceId);

		return c.json(await removeProject(workspaceId));
	});
