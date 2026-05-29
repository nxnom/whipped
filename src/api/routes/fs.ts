import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import { getExtensionPath, listDir, listTerminals, openPath, openTerminal } from "../services/fs-service.js";
import type { AppEnv } from "../types/context.js";

export const fsController = new Hono<AppEnv>()
	.post("/open", zv("json", z.object({ path: z.string() })), async (c) => {
		const { path } = c.req.valid("json");
		return c.json(openPath(path));
	})
	.get("/extension-path", async (c) => {
		return c.json(getExtensionPath());
	})
	.get("/terminals", async (c) => {
		return c.json(await listTerminals());
	})
	.post("/open-terminal", zv("json", z.object({ path: z.string() })), async (c) => {
		const { path } = c.req.valid("json");
		return c.json(await openTerminal(path));
	})
	.get(
		"/list-dir",
		zv(
			"query",
			z.object({
				path: z.string(),
				includeFiles: z.coerce.boolean().optional(),
				showHidden: z.coerce.boolean().optional(),
			}),
		),
		async (c) => {
			const { path, includeFiles, showHidden } = c.req.valid("query");
			return c.json(await listDir(path, includeFiles, showHidden));
		},
	);
