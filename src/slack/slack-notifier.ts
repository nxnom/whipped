import type { RuntimeBoardCard, RuntimeReviewComment } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { loadGlobalConfig } from "../config/runtime-config.js";
import { loadBoard, loadProjectConfig, updateCard } from "../state/workspace-state.js";
import { SlackClient } from "./slack-client.js";

function sanitizeChannelName(name: string): string {
	return `oe-${name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 75)}`;
}

function cardMessage(card: RuntimeBoardCard, done = false): string {
	const title = done ? `~${card.title}~` : `*${card.title}*`;
	const desc = card.description?.trim();
	if (!desc) return title;
	const snippet = desc.length > 300 ? `${desc.slice(0, 300)}…` : desc;
	return done ? `~${card.title}~\n~${snippet}~` : `*${card.title}*\n${snippet}`;
}


class SlackNotifier {
	private initialized = new Set<string>();
	private prevCards = new Map<string, Record<string, RuntimeBoardCard>>();
	private channelCache = new Map<string, string>(); // `${workspaceId}:${channelName}` → channelId
	private updateQueues = new Map<string, Promise<void>>(); // serialize per-workspace

	onWorkspaceUpdate(workspaceId: string, repoPath: string): void {
		const prev = this.updateQueues.get(workspaceId) ?? Promise.resolve();
		const next = prev.then(() => this.processUpdate(workspaceId, repoPath)).catch((err) => {
			logger.error({ err }, "[slack-notifier] onWorkspaceUpdate queue error");
		});
		this.updateQueues.set(workspaceId, next);
	}

	private async processUpdate(workspaceId: string, repoPath: string): Promise<void> {
		try {
			const config = await loadGlobalConfig();
			if (!config.slackBotToken) return;

			const board = await loadBoard(workspaceId);
			const cards = board.cards as Record<string, RuntimeBoardCard>;

			if (!this.initialized.has(workspaceId)) {
				this.prevCards.set(workspaceId, structuredClone(cards));
				this.initialized.add(workspaceId);
				return;
			}

			const prev = this.prevCards.get(workspaceId) ?? {};
			const client = new SlackClient(config.slackBotToken);
			const projectName = await this.getProjectName(workspaceId, repoPath);
			const installerUserId = config.slackInstallerUserId;

			for (const [cardId, card] of Object.entries(cards)) {
				const prevCard = prev[cardId];
				try {
					if (!prevCard) {
						await this.handleCardCreated(workspaceId, card, projectName, installerUserId, client);
					} else {
						if (prevCard.columnId !== card.columnId) {
							await this.handleColumnChanged(workspaceId, card, prevCard.columnId, card.columnId, projectName, installerUserId, client);
						}
						const prevCount = prevCard.reviewComments?.length ?? 0;
						const newComments = (card.reviewComments ?? []).slice(prevCount);
						for (const comment of newComments) {
							await this.handleReviewComment(workspaceId, card, comment, projectName, installerUserId, client);
						}
						if (!prevCard.pr?.url && card.pr?.url) {
							await this.handlePrCreated(workspaceId, card, projectName, installerUserId, client);
						}
					}
				} catch (err) {
					logger.error({ err, cardId }, "[slack-notifier] error processing card");
				}
			}

			this.prevCards.set(workspaceId, structuredClone(cards));
		} catch (err) {
			logger.error({ err }, "[slack-notifier] onWorkspaceUpdate failed");
		}
	}

	async joinExistingChannels(workspaceId: string): Promise<void> {
		try {
			const config = await loadGlobalConfig();
			if (!config.slackBotToken) return;
			const board = await loadBoard(workspaceId);
			const channelIds = new Set(
				Object.values(board.cards as Record<string, RuntimeBoardCard>)
					.map((c) => c.slackChannelId)
					.filter((id): id is string => !!id),
			);
			if (channelIds.size === 0) return;
			const client = new SlackClient(config.slackBotToken);
			for (const channelId of channelIds) {
				await client.joinChannel(channelId);
			}
			logger.info({ workspaceId, count: channelIds.size }, "[slack-notifier] rejoined existing channels");
		} catch (err) {
			logger.error({ err }, "[slack-notifier] joinExistingChannels failed");
		}
	}

	async replyToCard(card: RuntimeBoardCard, text: string): Promise<void> {
		if (!card.slackChannelId || !card.slackMessageTs) return;
		try {
			const config = await loadGlobalConfig();
			if (!config.slackBotToken) return;
			const client = new SlackClient(config.slackBotToken);
			await client.postMessage(card.slackChannelId, text, card.slackMessageTs);
		} catch (err) {
			logger.error({ err }, "[slack-notifier] replyToCard failed");
		}
	}

	// Used by incoming event handler to check card state
	async findCardByThreadTs(threadTs: string): Promise<{ workspaceId: string; card: RuntimeBoardCard } | null> {
		const { listWorkspaces } = await import("../state/workspace-state.js");
		const workspaces = await listWorkspaces();
		for (const { workspaceId } of workspaces) {
			const board = await loadBoard(workspaceId);
			for (const card of Object.values(board.cards as Record<string, RuntimeBoardCard>)) {
				if (card.slackMessageTs === threadTs) return { workspaceId, card };
			}
		}
		return null;
	}

	private async getOrCreateChannel(workspaceId: string, projectName: string, installerUserId: string | undefined, client: SlackClient): Promise<string> {
		const name = sanitizeChannelName(projectName);
		const cacheKey = `${workspaceId}:${name}`;
		const cached = this.channelCache.get(cacheKey);
		if (cached) return cached;

		let channelId = await client.findChannel(name);
		if (!channelId) {
			channelId = await client.createChannel(name);
		} else {
			await client.joinChannel(channelId);
		}

		if (installerUserId) {
			await client.inviteUsers(channelId, [installerUserId]);
		} else {
			// Fallback: invite all human workspace members (requires users:read scope)
			const humanIds = await client.getHumanUserIds();
			if (humanIds.length > 0) await client.inviteUsers(channelId, humanIds);
		}

		this.channelCache.set(cacheKey, channelId);
		return channelId;
	}

	private async ensureCardMessage(
		workspaceId: string,
		card: RuntimeBoardCard,
		channelId: string,
		client: SlackClient,
	): Promise<{ channelId: string; ts: string } | null> {
		if (card.slackMessageTs && card.slackChannelId) {
			return { channelId: card.slackChannelId, ts: card.slackMessageTs };
		}
		const ts = await client.postMessage(channelId, cardMessage(card));
		await updateCard(workspaceId, card.id, { slackMessageTs: ts, slackChannelId: channelId });
		// Keep prevCards in sync — covers both new cards (not yet in prev) and existing ones
		const prev = this.prevCards.get(workspaceId);
		if (prev) prev[card.id] = { ...(prev[card.id] ?? card), slackMessageTs: ts, slackChannelId: channelId };
		return { channelId, ts };
	}

	private async handleCardCreated(
		workspaceId: string,
		card: RuntimeBoardCard,
		projectName: string,
		installerUserId: string | undefined,
		client: SlackClient,
	): Promise<void> {
		const channelId = await this.getOrCreateChannel(workspaceId, projectName, installerUserId, client);
		await this.ensureCardMessage(workspaceId, card, channelId, client);
	}

	private async handleColumnChanged(
		workspaceId: string,
		card: RuntimeBoardCard,
		from: string,
		to: string,
		projectName: string,
		installerUserId: string | undefined,
		client: SlackClient,
	): Promise<void> {
		const channelId = await this.getOrCreateChannel(workspaceId, projectName, installerUserId, client);
		const msg = await this.ensureCardMessage(workspaceId, card, channelId, client);
		if (!msg) return;
		const { channelId: ch, ts } = msg;

		if (to === "done") {
			if (from === "done") return;
			await client.updateMessage(ch, ts, cardMessage(card, true));
			await client.addReaction(ch, ts, "white_check_mark");
			await client.postMessage(ch, `:white_check_mark: *Completed*`, ts);
		} else if (to === "in_progress") {
			await client.postMessage(ch, `:hammer: *Working on it…*`, ts);
		} else if (to === "ready_for_review") {
			await client.postMessage(ch, `:mag: *Ready for review*`, ts);
		} else if (to === "blocked") {
			await client.postMessage(ch, `:warning: *Blocked*`, ts);
		} else if (to === "reopened") {
			await client.updateMessage(ch, ts, cardMessage(card, false));
			await client.postMessage(ch, `:arrows_counterclockwise: *Reopened*`, ts);
		}

	}

	private async getActorLabel(workspaceId: string, comment: RuntimeReviewComment): Promise<string> {
		if (comment.actor.type === "human") return "*[You]*";
		try {
			const config = await loadProjectConfig(workspaceId);
			for (const workflow of config.workflows ?? []) {
				const slot = (workflow.slots ?? []).find((s) => s.id === comment.type || s.type === comment.type);
				if (slot?.name) return `*[${slot.name}]*`;
			}
		} catch { /* fall through */ }
		return `*[${comment.actor.id}]*`;
	}

	private async handleReviewComment(
		workspaceId: string,
		card: RuntimeBoardCard,
		comment: RuntimeReviewComment,
		projectName: string,
		installerUserId: string | undefined,
		client: SlackClient,
	): Promise<void> {
		if (!comment.summary?.trim()) return;
		if (comment.metadata?.fromSlack) return;
		const channelId = await this.getOrCreateChannel(workspaceId, projectName, installerUserId, client);
		const msg = await this.ensureCardMessage(workspaceId, card, channelId, client);
		if (!msg) return;

		const label = await this.getActorLabel(workspaceId, comment);
		await client.postMessage(msg.channelId, `${label}\n${comment.summary}`, msg.ts);
	}

	async notifyCardDeleted(card: RuntimeBoardCard): Promise<void> {
		if (!card.slackChannelId || !card.slackMessageTs) return;
		try {
			const config = await loadGlobalConfig();
			if (!config.slackBotToken) return;
			const client = new SlackClient(config.slackBotToken);
			await client.updateMessage(card.slackChannelId, card.slackMessageTs, cardMessage(card, true));
			await client.addReaction(card.slackChannelId, card.slackMessageTs, "wastebasket");
		} catch (err) {
			logger.error({ err }, "[slack-notifier] notifyCardDeleted failed");
		}
	}

	private async handlePrCreated(
		workspaceId: string,
		card: RuntimeBoardCard,
		projectName: string,
		installerUserId: string | undefined,
		client: SlackClient,
	): Promise<void> {
		if (!card.pr?.url) return;
		const channelId = await this.getOrCreateChannel(workspaceId, projectName, installerUserId, client);
		const msg = await this.ensureCardMessage(workspaceId, card, channelId, client);
		if (!msg) return;

		const title = card.pr.title ? ` — ${card.pr.title}` : "";
		await client.postMessage(msg.channelId, `*PR opened*${title}\n${card.pr.url}`, msg.ts);
	}

	private async getProjectName(workspaceId: string, repoPath: string): Promise<string> {
		try {
			const config = await loadProjectConfig(workspaceId);
			return config.name ?? repoPath.split("/").pop() ?? workspaceId;
		} catch {
			return repoPath.split("/").pop() ?? workspaceId;
		}
	}
}

export const slackNotifier = new SlackNotifier();
