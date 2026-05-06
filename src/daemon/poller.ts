import { logger } from "../core/logger.js";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { fetchPRInfo } from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, loadWorkspaceState, moveCard, updateCard, updateSession } from "../state/workspace-state.js";
import { createWorktree, getWorktreeBranch, getWorktreePath, removeWorktree } from "../worktree/worktree-manager.js";
import type { TaskScheduler } from "./scheduler.js";

function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
	return r.stdout?.trim() ?? "";
}

function cleanupWorktree(taskId: string, repoPath: string): void {
	try {
		removeWorktree(taskId, repoPath);
	} catch (err) {
		logger.error({ err }, `[poller] cleanupWorktree failed for ${taskId}:`);
	}
}

async function syncMainRepoAfterPRMerge(
	repoPath: string,
	baseRef: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	scheduler: TaskScheduler,
	stateHub: RuntimeStateHub,
): Promise<void> {
	try {
		spawnSync("git", ["fetch", "origin", baseRef], { cwd: repoPath, stdio: "ignore" });

		const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
		if (currentBranch !== baseRef) return;

		// Always attempt a real merge — handles both fast-forward and diverged cases
		const mergeResult = spawnSync("git", ["merge", `origin/${baseRef}`, "--no-ff", "--no-edit"], {
			cwd: repoPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (mergeResult.status === 0) {
			logger.info(`[poller] Synced main repo after PR merge (fast-forward) for "${card.title}"`);
			return;
		}

		// Conflicts — spawn resolution agent in the main repo
		const conflictsOut = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], {
			cwd: repoPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const conflictedFiles = conflictsOut.stdout.trim().split("\n").filter(Boolean);

		logger.info(`[poller] Merge conflicts in main repo after PR merge for "${card.title}": ${conflictedFiles.join(", ")}`);
		await scheduler.startConflictResolution(card, repoPath, conflictedFiles, async (success) => {
			if (!success) spawnSync("git", ["merge", "--abort"], { cwd: repoPath, stdio: "ignore" });
			logger.info(`[poller] Conflict resolution ${success ? "succeeded" : "failed"} for "${card.title}"`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
		});
	} catch (err) {
		logger.error({ err }, `[poller] syncMainRepoAfterPRMerge failed for "${card.title}":`);
	}
}

async function resolvePRConflicts(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	scheduler: TaskScheduler,
	stateHub: RuntimeStateHub,
): Promise<void> {
	try {
		const taskBranch = getWorktreeBranch(card.id);
		const worktreePath = getWorktreePath(card.id);

		if (!existsSync(worktreePath)) {
			createWorktree(card.id, repoPath, card.baseRef);
		}

		spawnSync("git", ["fetch", "origin", card.baseRef], { cwd: repoPath, stdio: "ignore" });

		const mergeResult = spawnSync("git", ["merge", `origin/${card.baseRef}`, "--no-ff", "--no-edit"], {
			cwd: worktreePath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (mergeResult.status === 0) {
			spawnSync("git", ["push", "origin", taskBranch], { cwd: worktreePath, stdio: "ignore" });
			await appendActivityLog(workspaceId, card.id, `PR conflict resolved by merging ${card.baseRef} → pushed`);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
			return;
		}

		const conflictsOut = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], {
			cwd: worktreePath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const conflictedFiles = conflictsOut.stdout.trim().split("\n").filter(Boolean);

		await appendActivityLog(workspaceId, card.id, `PR has merge conflicts: ${conflictedFiles.join(", ")} — resolving...`);
		await updateSession(workspaceId, card.id, { state: "running" });
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		await scheduler.startConflictResolution(card, worktreePath, conflictedFiles, async (success) => {
			if (success) {
				spawnSync("git", ["push", "origin", taskBranch], { cwd: worktreePath, stdio: "ignore" });
				await appendActivityLog(workspaceId, card.id, `PR conflicts resolved → pushed`);
				await updateSession(workspaceId, card.id, { state: "awaiting_review" });
			} else {
				spawnSync("git", ["merge", "--abort"], { cwd: worktreePath, stdio: "ignore" });
				await moveCard(workspaceId, card.id, "blocked");
				await appendActivityLog(workspaceId, card.id, "Could not resolve PR conflicts → Blocked");
				await updateSession(workspaceId, card.id, { state: "idle" });
			}
			stateHub.broadcastWorkspaceUpdate(workspaceId);
		});
	} catch (err) {
		logger.error({ err }, `[poller] resolvePRConflicts failed for "${card.title}":`);
	}
}

const DEPLOYMENT_BOTS = new Set([
	"vercel",
	"vercel[bot]",
	"netlify",
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

		// Sort by priority (urgent→high→medium→low→none), then stable by column position
		const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
		pendingCards.sort((a, b) => {
			const pa = a.priority ? (PRIORITY_ORDER[a.priority] ?? 4) : 4;
			const pb = b.priority ? (PRIORITY_ORDER[b.priority] ?? 4) : 4;
			return pa - pb;
		});

		// Track in-flight count locally so the check stays accurate as we dispatch
		// within the same poll cycle (the board snapshot is stale after each startTask).
		let inFlightCount =
			(board.columns.find((c) => c.id === "in_progress")?.taskIds.length ?? 0) +
			(board.columns.find((c) => c.id === "in_review")?.taskIds.length ?? 0);

		for (const card of pendingCards) {
			if (!scheduler.canAcceptTask(inFlightCount)) break;
			// Skip cards whose dependencies are not yet in ready_for_review or done
			const unmetDep = (card.dependsOn ?? []).find((depId) => {
				const dep = board.cards[depId];
				return !dep || (dep.columnId !== "ready_for_review" && dep.columnId !== "done");
			});
			if (unmetDep) continue;
			logger.info(`[poller] Dispatching card "${card.title}" from ${card.columnId} (in-flight: ${inFlightCount}/${scheduler.maxParallelTasks})`);
			inFlightCount++;
			await scheduler.startTask(card);
		}

		const inReviewColumn = board.columns.find((c) => c.id === "in_review");
		if (inReviewColumn) {
			for (const taskId of inReviewColumn.taskIds) {
				const card = board.cards[taskId];
				const session = state.sessions[taskId];
				if (card && session?.state === "awaiting_review") {
					onCardReadyForReview(card);
				}
			}
		}
	}

	async pollPRs(): Promise<void> {
		const { workspaceId, repoPath, stateHub, scheduler } = this.options;

		const state = await loadWorkspaceState(workspaceId, repoPath);
		const rfr = state.board.columns.find((c) => c.id === "ready_for_review");
		if (!rfr) return;

		const cardsWithPR = rfr.taskIds.filter((id) => state.board.cards[id]?.githubPrUrl);
		if (cardsWithPR.length === 0) return;

		for (const taskId of cardsWithPR) {
			const card = state.board.cards[taskId]!;

			const info = await fetchPRInfo(card.githubPrUrl!);
			if (!info) {
				logger.warn(`[poller] Could not fetch PR info for "${card.title}" (${card.githubPrUrl})`);
				continue;
			}

			const seenIds = new Set(card.githubCommentIds ?? []);
			const allEntries = [...info.comments, ...info.reviews];
			const botEntries = allEntries.filter((e) => DEPLOYMENT_BOTS.has(e.author));
			const humanEntries = allEntries.filter((e) => !DEPLOYMENT_BOTS.has(e.author));

			// Mark bot IDs as seen so we never reprocess them
			const newBotIds = botEntries.filter((e) => !seenIds.has(e.id)).map((e) => e.id);
			if (newBotIds.length > 0) newBotIds.forEach((id) => seenIds.add(id));

			const newEntries = humanEntries.filter((e) => !seenIds.has(e.id));

			let updated = false;

			// Strip any bot comments that snuck in before the filter was added
			const cleanedComments = (card.reviewComments ?? []).filter((c) => !DEPLOYMENT_BOTS.has(c.agent));
			const hadBotComments = cleanedComments.length !== (card.reviewComments ?? []).length;

			if (newEntries.length > 0 || hadBotComments || newBotIds.length > 0) {
				const newComments = [
					...cleanedComments,
					...newEntries.map((e) => ({
						type: "human" as const,
						agent: e.author,
						content: e.body,
						createdAt: new Date(e.createdAt).getTime(),
						source: "github" as const,
					})),
				];
				const newIds = [...seenIds, ...newEntries.map((e) => e.id)];
				await updateCard(workspaceId, taskId, { reviewComments: newComments, githubCommentIds: newIds });
				if (newEntries.length > 0) {
					logger.info(`[poller] ${newEntries.length} new comment(s) from GitHub PR for "${card.title}"`);
					await appendActivityLog(workspaceId, taskId, `${newEntries.length} new comment(s) imported from GitHub PR`);
				}
				updated = true;
			}

			const authorCommented = newEntries.some((e) => e.author === info.author);
			const changesRequested = info.reviewDecision === "CHANGES_REQUESTED";

			if (info.state === "MERGED") {
				logger.info(`[poller] PR merged for "${card.title}" → Done`);
				await moveCard(workspaceId, taskId, "done");
				await updateSession(workspaceId, taskId, { state: "idle" });
				await appendActivityLog(workspaceId, taskId, "PR merged on GitHub → Done");
				cleanupWorktree(taskId, repoPath);
				void syncMainRepoAfterPRMerge(repoPath, card.baseRef, card, workspaceId, scheduler, stateHub);
				updated = true;
			} else if (info.state === "CLOSED") {
				logger.info(`[poller] PR closed without merging for "${card.title}" → Blocked`);
				await moveCard(workspaceId, taskId, "blocked");
				await updateSession(workspaceId, taskId, { state: "idle" });
				await appendActivityLog(workspaceId, taskId, "PR closed without merging → Blocked");
				updated = true;
			} else if (info.mergeable === "CONFLICTING") {
				const session = state.sessions[taskId];
				const idle = !session || session.state === "idle" || session.state === "awaiting_review";
				if (idle) {
					logger.info(`[poller] PR has merge conflicts for "${card.title}" → resolving`);
					void resolvePRConflicts(repoPath, card, workspaceId, scheduler, stateHub);
					updated = true;
				}
			} else if (changesRequested || authorCommented) {
				const reason = changesRequested ? "Changes Requested review submitted" : `PR author (${info.author}) commented`;
				logger.info(`[poller] "${card.title}": ${reason} → Reopened`);
				await moveCard(workspaceId, taskId, "reopened");
				await appendActivityLog(workspaceId, taskId, `${reason} → Reopened`);
				await updateSession(workspaceId, taskId, { state: "idle" });
				updated = true;
			}

			if (updated) stateHub.broadcastWorkspaceUpdate(workspaceId);
		}
	}
}
