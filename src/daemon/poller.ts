import type { RuntimeAgentId, RuntimeBoardCard } from "../core/api-contract.js";
import { loadWorkspaceState } from "../state/workspace-state.js";
import type { TaskScheduler } from "./scheduler.js";

interface PollerOptions {
	workspaceId: string;
	repoPath: string;
	pollingIntervalSeconds: number;
	scheduler: TaskScheduler;
	onCardReadyForReview: (card: RuntimeBoardCard) => void;
}

export class BoardPoller {
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(private options: PollerOptions) {}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.schedulePoll();
	}

	stop(): void {
		this.running = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private schedulePoll(): void {
		const intervalMs = this.options.pollingIntervalSeconds * 1000;
		this.timer = setTimeout(async () => {
			if (!this.running) return;
			await this.poll();
			if (this.running) {
				this.schedulePoll();
			}
		}, intervalMs);
	}

	async poll(): Promise<void> {
		const { workspaceId, repoPath, scheduler, onCardReadyForReview } = this.options;

		const state = await loadWorkspaceState(workspaceId, repoPath);
		if (!state.autonomousModeEnabled) return;

		const board = state.board;

		// Collect cards that need agent work: ready_for_dev + reopened
		const actionableColumnIds = ["ready_for_dev", "reopened"] as const;
		const pendingCards: RuntimeBoardCard[] = [];

		for (const columnId of actionableColumnIds) {
			const column = board.columns.find((c) => c.id === columnId);
			if (!column) continue;
			for (const taskId of column.taskIds) {
				const card = board.cards[taskId];
				const session = state.sessions[taskId];
				// No session = fresh card; idle = review failed and was reset
				if (card && (!session || session.state === "idle")) {
					pendingCards.push(card);
				}
			}
		}

		// Dispatch up to the parallel limit
		for (const card of pendingCards) {
			if (!scheduler.canAcceptTask()) break;
			console.log(`[poller] Dispatching card "${card.title}" from ${card.columnId}`);
			await scheduler.startTask(card);
		}

		// Collect cards that moved to in_review and trigger review pipeline
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
}
