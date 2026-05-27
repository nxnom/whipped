import { logger } from "../core/logger.js";

type SlackApiResponse = { ok: boolean; error?: string };

export class SlackClient {
	private static readonly BASE = "https://slack.com/api";

	constructor(private readonly botToken: string) {}

	private async call<T extends SlackApiResponse>(method: string, body: Record<string, unknown>): Promise<T> {
		const res = await fetch(`${SlackClient.BASE}/${method}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				Authorization: `Bearer ${this.botToken}`,
			},
			body: JSON.stringify(body),
		});
		const data = (await res.json()) as T;
		if (!data.ok) throw new Error(`Slack ${method}: ${data.error ?? "unknown error"}`);
		return data;
	}

	async postMessage(channelId: string, text: string, threadTs?: string): Promise<string> {
		const body: Record<string, unknown> = { channel: channelId, text, mrkdwn: true };
		if (threadTs) body.thread_ts = threadTs;
		const data = await this.call<SlackApiResponse & { ts: string }>("chat.postMessage", body);
		return data.ts;
	}

	async updateMessage(channelId: string, ts: string, text: string): Promise<void> {
		await this.call("chat.update", { channel: channelId, ts, text, mrkdwn: true });
	}

	async createChannel(name: string): Promise<string> {
		for (const candidate of [name, `${name}-pub`]) {
			try {
				const data = await this.call<SlackApiResponse & { channel: { id: string } }>("conversations.create", {
					name: candidate,
					is_private: false,
				});
				return data.channel.id;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("name_taken")) {
					const existing = await this.findChannel(candidate);
					if (existing) {
						await this.joinChannel(existing);
						return existing;
					}
					// name taken by a private channel we can't access — try next candidate
					continue;
				}
				throw err;
			}
		}
		throw new Error(`Could not create Slack channel: ${name}`);
	}

	async findChannel(name: string): Promise<string | null> {
		let cursor: string | undefined;
		while (true) {
			const body: Record<string, unknown> = { types: "public_channel", limit: 200, exclude_archived: true };
			if (cursor) body.cursor = cursor;
			const data = await this.call<
				SlackApiResponse & {
					channels: Array<{ id: string; name: string }>;
					response_metadata?: { next_cursor?: string };
				}
			>("conversations.list", body);

			const found = data.channels.find((c) => c.name === name);
			if (found) return found.id;

			cursor = data.response_metadata?.next_cursor;
			if (!cursor) break;
		}
		return null;
	}

	async joinChannel(channelId: string): Promise<void> {
		try {
			await this.call("conversations.join", { channel: channelId });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (
				msg.includes("channel_not_found") ||
				msg.includes("already_in_channel") ||
				msg.includes("method_not_supported_for_channel_type")
			)
				return;
			logger.warn({ err }, "[slack] conversations.join failed");
		}
	}

	async getHumanUserIds(): Promise<string[]> {
		try {
			const data = await this.call<
				SlackApiResponse & {
					members: Array<{ id: string; is_bot: boolean; deleted: boolean; name: string }>;
				}
			>("users.list", { limit: 200 });
			return data.members.filter((m) => !m.is_bot && !m.deleted && m.id !== "USLACKBOT").map((m) => m.id);
		} catch {
			return [];
		}
	}

	async addReaction(channelId: string, ts: string, emoji: string): Promise<void> {
		try {
			await this.call("reactions.add", { channel: channelId, timestamp: ts, name: emoji });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("already_reacted")) logger.warn({ err }, "[slack] reactions.add failed");
		}
	}

	async inviteUsers(channelId: string, userIds: string[]): Promise<void> {
		if (userIds.length === 0) return;
		try {
			await this.call("conversations.invite", { channel: channelId, users: userIds.join(",") });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("already_in_channel")) {
				logger.warn({ err }, "[slack] conversations.invite failed");
			}
		}
	}
}
