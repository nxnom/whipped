import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../middleware/zv.js";
import {
	checkCloudflared,
	cloudflaredLogin,
	createApp,
	createSlackTunnel,
	getTunnelConfig,
	getTunnelStatus,
	importCredentials,
	resetApp,
	resetTunnel,
	startTunnel,
	stopTunnel,
	updateSigningSecret,
} from "../services/slack-service.js";
import type { AppEnv } from "../types/context.js";

export const slackController = new Hono<AppEnv>()
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
		return c.json(await createSlackTunnel(c.req.valid("json").domain));
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
	})
	.post("/resetApp", async (c) => {
		await resetApp();
		return c.json({ ok: true });
	})
	.post("/updateSigningSecret", zv("json", z.object({ signingSecret: z.string().min(1) })), async (c) => {
		await updateSigningSecret(c.req.valid("json").signingSecret);
		return c.json({ ok: true });
	})
	.post(
		"/importCredentials",
		zv(
			"json",
			z.object({
				slackAppId: z.string(),
				slackClientId: z.string(),
				slackClientSecret: z.string(),
				slackSigningSecret: z.string(),
				slackOauthAuthorizeUrl: z.string(),
				slackPublicUrl: z.string(),
			}),
		),
		async (c) => {
			await importCredentials(c.req.valid("json"));
			return c.json({ ok: true });
		},
	)
	.post(
		"/createApp",
		zv("json", z.object({ appConfigToken: z.string(), publicUrl: z.string(), botName: z.string().default("Whipped") })),
		async (c) => {
			const { appConfigToken, publicUrl, botName } = c.req.valid("json");
			return c.json(await createApp(appConfigToken, publicUrl, botName));
		},
	);
