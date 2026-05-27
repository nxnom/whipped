import { logger } from "../core/logger.js";

const BACKEND_PORT = 50008;

function buildManifest(publicUrl: string) {
	return {
		display_information: {
			name: "Overemployed",
			description: "AI agent task notifications",
			background_color: "#1a1a2e",
		},
		features: {
			bot_user: { display_name: "Overemployed", always_online: true },
			slash_commands: [
				{
					command: "/reopen",
					url: `${publicUrl}/api/slack/commands`,
					description: "Reopen a task from its thread",
					should_escape: false,
				},
			],
		},
		oauth_config: {
			redirect_urls: [`${publicUrl}/api/slack/oauth-callback`],
			scopes: {
				bot: [
					"channels:manage",
					"channels:join",
					"channels:read",
					"channels:history",
					"chat:write",
					"chat:write.public",
					"groups:write",
					"groups:read",
					"groups:history",
					"commands",
				],
			},
		},
		settings: {
			event_subscriptions: {
				request_url: `${publicUrl}/api/slack/events`,
				bot_events: ["message.channels", "message.groups"],
			},
			interactivity: { is_enabled: false },
			org_deploy_enabled: false,
			socket_mode_enabled: false,
			token_rotation_enabled: false,
		},
	};
}

export interface CreatedSlackApp {
	appId: string;
	clientId: string;
	clientSecret: string;
	signingSecret: string;
	verificationToken: string;
	oauthAuthorizeUrl: string;
}

export async function createSlackApp(
	appConfigToken: string,
	publicUrl: string,
): Promise<CreatedSlackApp> {
	const manifest = buildManifest(publicUrl);

	const res = await fetch("https://slack.com/api/apps.manifest.create", {
		method: "POST",
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			Authorization: `Bearer ${appConfigToken}`,
		},
		body: JSON.stringify({ manifest }),
	});

	const data = (await res.json()) as {
		ok: boolean;
		error?: string;
		app_id?: string;
		credentials?: {
			client_id: string;
			client_secret: string;
			signing_secret: string;
			verification_token: string;
		};
		oauth_authorize_url?: string;
	};

	if (!data.ok) {
		logger.error({ error: data.error }, "[slack-setup] apps.manifest.create failed");
		if (data.error === "not_allowed_token_type") {
			throw new Error(
				"Wrong token type — use an App Configuration Token from api.slack.com/apps (scroll to the bottom → Your App Configuration Tokens → Generate Token)",
			);
		}
		throw new Error(data.error ?? "apps.manifest.create failed");
	}

	return {
		appId: data.app_id!,
		clientId: data.credentials!.client_id,
		clientSecret: data.credentials!.client_secret,
		signingSecret: data.credentials!.signing_secret,
		verificationToken: data.credentials!.verification_token,
		oauthAuthorizeUrl: data.oauth_authorize_url!,
	};
}

export async function exchangeCodeForBotToken(
	code: string,
	clientId: string,
	clientSecret: string,
	publicUrl: string,
): Promise<string> {
	const params = new URLSearchParams({
		code,
		client_id: clientId,
		client_secret: clientSecret,
		redirect_uri: `${publicUrl}/api/slack/oauth-callback`,
	});

	const res = await fetch(`https://slack.com/api/oauth.v2.access?${params}`);
	const data = (await res.json()) as {
		ok: boolean;
		error?: string;
		access_token?: string;
	};

	if (!data.ok) {
		throw new Error(data.error ?? "oauth.v2.access failed");
	}

	return data.access_token!;
}

export function getLocalCallbackUrl(): string {
	return `http://127.0.0.1:${BACKEND_PORT}/api/slack/oauth-callback`;
}
