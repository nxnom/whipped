import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import {
	checkCloudflared,
	cloudflaredLogin,
	createTunnel,
	getTunnelConfig,
	getTunnelStatus,
	resetTunnel,
	startTunnel,
	stopTunnel,
} from "../services/tunnel-service.js";
import type { AppEnv } from "../types/context.js";

export const tunnelController = new Hono<AppEnv>()
	.get("/checkCloudflared", async (c) => {
		return c.json(await checkCloudflared());
	})
	.get("/tunnelConfig", async (c) => {
		return c.json(await getTunnelConfig());
	})
	.get("/tunnelStatus", async (c) => {
		return c.json(await getTunnelStatus());
	})
	.post("/cloudflaredLogin", zv("json", z.object({ force: z.boolean().default(false) })), async (c) => {
		return c.json(await cloudflaredLogin(c.req.valid("json").force));
	})
	.post("/createTunnel", zv("json", z.object({ domain: z.string() })), async (c) => {
		return c.json(await createTunnel(c.req.valid("json").domain));
	})
	.post("/startTunnel", async (c) => {
		return c.json(await startTunnel());
	})
	.post("/stopTunnel", async (c) => {
		return c.json(await stopTunnel());
	})
	.post("/resetTunnel", async (c) => {
		await resetTunnel();
		return c.json({ ok: true });
	});
