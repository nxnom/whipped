import { loadGlobalConfig, updateGlobalConfig } from "../../config/runtime-config.js";
import type { RuntimeGlobalConfig } from "../../core/api-contract.js";
import {
	checkCloudflaredAuth,
	checkCloudflaredInstalled,
	createTunnel,
	openCloudflaredLogin,
	readTunnelConfig,
	routeDns,
	writeTunnelConfig,
} from "../../slack/cloudflare-setup.js";
import { tunnelManager } from "../../slack/cloudflare-tunnel.js";
import { createSlackApp } from "../../slack/slack-setup.js";

const SLACK_BOT_SCOPES =
	"channels:manage,channels:join,channels:read,channels:history,chat:write,chat:write.public,groups:write,groups:read,groups:history,commands";

export const checkCloudflared = async () => {
	const [install, authed] = await Promise.all([checkCloudflaredInstalled(), checkCloudflaredAuth()]);
	return { ...install, authed };
};

export const cloudflaredLogin = async (force: boolean) => openCloudflaredLogin(force);

export const createSlackTunnel = async (domain: string) => {
	const config = await loadGlobalConfig();
	const name = config.tunnelName ?? "whipped";
	const { tunnelId } = await createTunnel(name);
	await writeTunnelConfig(tunnelId, name, domain);
	await routeDns(name, domain);
	await updateGlobalConfig({ tunnelId, tunnelDomain: domain });
	return { tunnelId };
};

export const getTunnelConfig = async () => {
	const [config, fileConfig] = await Promise.all([loadGlobalConfig(), readTunnelConfig()]);
	return {
		tunnelId: config.tunnelId ?? fileConfig?.tunnelId,
		domain: config.tunnelDomain ?? fileConfig?.domain,
		tunnelName: config.tunnelName ?? "whipped",
	};
};

export const getTunnelStatus = async () => tunnelManager.getState();

export const startTunnel = async () => {
	tunnelManager.start();
	return tunnelManager.getState();
};

export const stopTunnel = async () => {
	tunnelManager.stop();
	return tunnelManager.getState();
};

export const resetTunnel = async () => {
	tunnelManager.stop();
	await updateGlobalConfig({ tunnelId: undefined, tunnelDomain: undefined, autoStartTunnel: false });
	// Remove the cloudflared config file so the wizard starts clean
	const { unlink } = await import("node:fs/promises");
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	try {
		await unlink(join(homedir(), ".cloudflared", "config.yml"));
	} catch {
		/* already gone */
	}
};

export const resetApp = async () => {
	await updateGlobalConfig({
		slackBotToken: undefined,
		slackSigningSecret: undefined,
		slackAppConfigToken: undefined,
		slackClientId: undefined,
		slackClientSecret: undefined,
		slackAppId: undefined,
		slackOauthAuthorizeUrl: undefined,
		slackPublicUrl: undefined,
		slackBotName: undefined,
		slackInstallerUserId: undefined,
	});
};

export const updateSigningSecret = async (signingSecret: string) => {
	await updateGlobalConfig({ slackSigningSecret: signingSecret });
};

export const importCredentials = async (credentials: Partial<RuntimeGlobalConfig>) => {
	await updateGlobalConfig(credentials);
};

export const createApp = async (appConfigToken: string, publicUrl: string, botName: string) => {
	const existing = await loadGlobalConfig();
	const app = await createSlackApp(appConfigToken, publicUrl, existing.slackAppId, botName);
	const clientId = app.clientId || existing.slackClientId || "";
	const oauthAuthorizeUrl =
		app.oauthAuthorizeUrl ||
		existing.slackOauthAuthorizeUrl ||
		(clientId ? `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${SLACK_BOT_SCOPES}` : "");
	await updateGlobalConfig({
		slackAppConfigToken: appConfigToken,
		slackAppId: app.appId,
		slackPublicUrl: publicUrl,
		slackBotName: botName,
		...(app.clientId && { slackClientId: app.clientId }),
		...(app.clientSecret && { slackClientSecret: app.clientSecret }),
		...(app.signingSecret && { slackSigningSecret: app.signingSecret }),
		slackOauthAuthorizeUrl: oauthAuthorizeUrl,
	});
	return { ...app, oauthAuthorizeUrl };
};
