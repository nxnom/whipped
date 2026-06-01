import { loadGlobalConfig, updateGlobalConfig } from "../../config/runtime-config.js";
import type { RuntimeGlobalConfig } from "../../core/api-contract.js";
import { createSlackApp } from "../../slack/slack-setup.js";

const SLACK_BOT_SCOPES =
	"channels:manage,channels:join,channels:read,channels:history,chat:write,chat:write.public,groups:write,groups:read,groups:history,commands";

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
