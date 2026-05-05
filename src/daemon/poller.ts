import { spawnSync } from "node:child_process";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { fetchPRInfo } from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, loadWorkspaceState, moveCard, updateCard, updateSession } from "../state/workspace-state.js";
import { removeWorktree } from "../worktree/worktree-manager.js";
import type { TaskScheduler } from "./scheduler.js";

function cleanupAfterMerge(taskId: string, repoPath: string, baseRef: string): void {
	try {
		removeWorktree(taskId, repoPath);
	} catch {
		// best-effort
	}
	try {
		spawnSync("git", ["fetch", "origin", baseRef], { cwd: repoPath, stdio: "ignore" });
	} catch {
		// best-effort
	}
}

const DEPLOYMENT_BOTS = new Set([
	"vercel[bot]",
	"netlify[bot]",
	"railway[bot]",
	"render[bot]",
	"heroku[bot]",
	"github-actions[bot]",
]);

interface PollerOptions {
	workspaceId: string;
	repoPath: string;
	pollingIntervalSeconds: number;
	prPollingIntervalSeconds: number;
	scheduler: TaskScheduler;
	stateHub: RuntimeStateHub;
	onCardReadyForReview: (card: RuntimeBoardCard) => void;
}

export class BoardPoller {
	private timer: NodeJS.Timeout | null = null;
	private prTimer: NodeJS.Timeout | null = null;
	private running = false;
	private prPollingActive = false;

	constructor(private options: PollerOptions) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.schedulePoll();
	}

	stop(): void {
		this.running = false;
		this.prPollingActive = false;
		if (this.timer) { clearTimeout(this.timer); this.timer = null; }
		if (this.prTimer) { clearTimeout(this.prTimer); this.prTimer = null; }
	}

	startPRPolling(): void {
		if (this.prPollingActive) return;
		this.prPollingActive = true;
		this.schedulePRPoll();
	}

	private schedulePoll(): void {
		this.timer = setTimeout(async () => {
			if (!this.running) return;
			await this.poll();
			if (this.running) this.schedulePoll();
		}, this.options.pollingIntervalSeconds * 1000);
	}

	private schedulePRPoll(): void {
		this.prTimer = setTimeout(async () => {
			if (!this.prPollingActive) return;
			await this.pollPRs();
			if (this.prPollingActive) this.schedulePRPoll();
		}, this.options.prPollingIntervalSeconds * 1000);
	}

	async poll(): Promise<void> {
		const { workspaceId, repoPath, scheduler, onCardReadyForReview } = this.options;
		const state = await loadWorkspaceState(workspaceId, repoPath);
		if (!state.autonomousModeEnabled) return;

		const board = state.board;
		const pendingCards: RuntimeBoardCard[] = [];

		for (const columnId of ["ready_for_dev", "reopened"] as const) {
			const column = board.columns.find((c) => c.id === columnId);
			if (!column) continue;
			for (const taskId of column.taskIds) {
				const card = board.cards[taskId];
				const session = state.sessions[taskId];
				if (card && (!session || session.state === "idle")) pendingCards.push(card);
			}
		}

		for (const card of pendingCards) {
			if (!scheduler.canAcceptTask()) break;
			console.log(`[poller] Dispatching card "${card.title}" from ${card.columnId}`);
			await scheduler.startTask(card);
		}

		const inReviewColumn = board.columns.find((c) => c.id === "in_review");
		if (inReviewColumn) {
			for (const taskId of inReviewColumn.taskIds) {
				const card = board.cards[taskId];
				const session = state.sessions[taskId];
				if (card && session?.state === "awaiting_review") {
					console.log(`[poller] Triggering review pipeline for "${card.title}"`);
					onCardReadyForReview(card);
				}
			}
		}
	}

	async pollPRs(): Promise<void> {
		const { workspaceId, repoPath, stateHub } = this.options;

		const state = await loadWorkspaceState(workspaceId, repoPath);
		const rfr = state.board.columns.find((c) => c.id === "ready_for_review");
		if (!rfr) return;

		const cardsWithPR = rfr.taskIds.filter((id) => state.board.cards[id]?.githubPrUrl);
		if (cardsWithPR.length === 0) return;

		for (const taskId of cardsWithPR) {
			const card = state.board.cards[taskId]!;

			const info = fetchPRInfo(card.githubPrUrl!);
			if (!info) continue;

			const seenIds = new Set(card.githubCommentIds ?? []);
			const allEntries = [...info.comments, ...info.reviews].filter((e) => !DEPLOYMENT_BOTS.has(e.author));
			const newEntries = allEntries.filter((e) => !seenIds.has(e.id));

			let updated = false;

			if (newEntries.length > 0) {
				const newComments = [
					...(card.reviewComments ?? []),
					...newEntries.map((e) => ({
						type: "human" as const,
						agent: e.author,
						content: e.body,
						createdAt: new Date(e.createdAt).getTime(),
					})),
				];
				const newIds = [...seenIds, ...newEntries.map((e) => e.id)];
				await updateCard(workspaceId, taskId, { reviewComments: newComments, githubCommentIds: newIds });
				await appendActivityLog(workspaceId, taskId, `${newEntries.length} new comment(s) imported from GitHub PR`);
				updated = true;
			}

			const authorCommented = newEntries.some((e) => e.author === info.author);
			const changesRequested = info.reviewDecision === "CHANGES_REQUESTED";

			if (info.state === "MERGED") {
				await moveCard(workspaceId, taskId, "done");
				await updateSession(workspaceId, taskId, { state: "idle" });
				await appendActivityLog(workspaceId, taskId, "PR merged on GitHub → Done");
				cleanupAfterMerge(taskId, repoPath, card.baseRef);
				updated = true;
			} else if (info.state === "CLOSED") {
				await moveCard(workspaceId, taskId, "blocked");
				await updateSession(workspaceId, taskId, { state: "idle" });
				await appendActivityLog(workspaceId, taskId, "PR closed without merging → Blocked");
				updated = true;
			} else if (changesRequested || authorCommented) {
				const reason = changesRequested ? "Changes Requested review submitted" : `PR author (${info.author}) commented`;
				await moveCard(workspaceId, taskId, "reopened");
				await appendActivityLog(workspaceId, taskId, `${reason} → Reopened`);
				await updateSession(workspaceId, taskId, { state: "idle" });
				updated = true;
			}

			if (updated) stateHub.broadcastWorkspaceUpdate(workspaceId);
		}
	}
}
