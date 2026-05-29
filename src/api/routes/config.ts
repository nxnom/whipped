import { Hono } from "hono";
import { runtimeGlobalConfigSchema } from "../../core/api-contract.js";
import { zv } from "../middleware/zv.js";
import { getGlobalConfig, saveGlobalConfig } from "../services/config-service.js";
import type { AppEnv } from "../types/context.js";

export const configController = new Hono<AppEnv>()
	.get("/", async (c) => {
		return c.json(await getGlobalConfig());
	})
	.put("/", zv("json", runtimeGlobalConfigSchema.partial()), async (c) => {
		return c.json(await saveGlobalConfig(c.req.valid("json")));
	});
