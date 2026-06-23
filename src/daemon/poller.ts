import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadGlobalConfig } from "../config/runtime-config.js";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import { generateTaskId } from "../core/task-id.js";
import { fetchCommentBodyHtml, fetchPRInfo } from "../git/merge-operations.js";
import { playNotificationSound } from "../notifications/sound-player.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	appendActivityLog,
	clearCardSession,
	downloadGithubImages,
	loadBoard,
	loadWorkspaceState,
	moveCard,
	updateCard,
} from "../state/workspace-state.js";
import {
	createWorktree,
	getCardBranch,
	getWorktreePath,
	removeWorktreeAsync,
	resolveWorktreeOwnerId,
} from "../worktree/worktree-manager.js";
import type { TaskScheduler } from "./scheduler.js";
import { enqueueYoloMerge } from "./yolo-merge.js";

function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
	return r.stdout?.trim() ?? "";
}

async function cleanupWorktree(taskId: string, repoPath: string, branchName?: string): Promise<void> {
	try {
		await removeWorktreeAsync(taskId, repoPath, branchName);
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
			logger.info(
				`[poller] Synced main repo after PR merge (fast-forward) for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
			);
			return;
		}

		// Conflicts — spawn resolution agent in the main repo
		const conflictsOut = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], {
			cwd: repoPath,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const conflictedFiles = conflictsOut.stdout.trim().split("\n").filter(Boolean);

		logger.info(
			`[poller] Merge conflicts in main repo after PR merge for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}": ${conflictedFiles.join(", ")}`,
		);
		await scheduler.startConflictResolution(card, repoPath, conflictedFiles, async (success) => {
			if (!success) spawnSync("git", ["merge", "--abort"], { cwd: repoPath, stdio: "ignore" });
			logger.info(
				`[poller] Conflict resolution ${success ? "succeeded" : "failed"} for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
			);
			stateHub.broadcastWorkspaceUpdate(workspaceId);
		});
	} catch (err) {
		logger.error(
			{ err },
			`[poller] syncMainRepoAfterPRMerge failed for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}":`,
		);
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
		const taskBranch = getCardBranch(card);
		const conflictBoard = await loadBoard(workspaceId);
		const ownerCardId = resolveWorktreeOwnerId(card.id, conflictBoard.cards);
		const ownsWorktree = ownerCardId === card.id;
		const worktreePath = getWorktreePath(ownerCardId);

		if (!existsSync(worktreePath)) {
			createWorktree(ownerCardId, repoPath, card.baseRef, ownsWorktree ? card.branchName : undefined);
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

		await appendActivityLog(
			workspaceId,
			card.id,
			`PR has merge conflicts: ${conflictedFiles.join(", ")} — resolving...`,
		);
		stateHub.broadcastWorkspaceUpdate(workspaceId);

		await scheduler.startConflictResolution(card, worktreePath, conflictedFiles, async (success) => {
			if (success) {
				spawnSync("git", ["push", "origin", taskBranch], { cwd: worktreePath, stdio: "ignore" });
				await appendActivityLog(workspaceId, card.id, `PR conflicts resolved → pushed`);
			} else {
				spawnSync("git", ["merge", "--abort"], { cwd: worktreePath, stdio: "ignore" });
				await moveCard(workspaceId, card.id, "blocked");
				await appendActivityLog(workspaceId, card.id, "Could not resolve PR conflicts → Blocked");
			}
			stateHub.broadcastWorkspaceUpdate(workspaceId);
		});
	} catch (err) {
		logger.error(
			{ err },
			`[poller] resolvePRConflicts failed for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}":`,
		);
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
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.prTimer) {
			clearTimeout(this.prTimer);
			this.prTimer = null;
		}
	}

	startPRPolling(): void {
		if (this.prPollingActive) return;
		this.prPollingActive = true;
		this.schedulePRPoll();
	}

	private schedulePoll(): void {
		this.timer = setTimeout(async () => {
			if (!this.running) return;
			await this.poll().catch((err) => logger.error(`[poller] poll() threw unexpectedly: ${String(err)}`));
			if (this.running) this.schedulePoll();
		}, this.options.pollingIntervalSeconds * 1000);
	}

	private schedulePRPoll(): void {
		this.prTimer = setTimeout(async () => {
			if (!this.prPollingActive) return;
			await this.pollPRs().catch((err) => logger.error(`[poller] pollPRs() threw unexpectedly: ${String(err)}`));
			if (this.prPollingActive) this.schedulePRPoll();
		}, this.options.prPollingIntervalSeconds * 1000);
	}

	async poll(): Promise<void> {
		const { workspaceId, repoPath, scheduler, stateHub, onCardReadyForReview } = this.options;
		const state = await loadWorkspaceState(workspaceId, repoPath);

		// Re-sync the concurrency limit from fresh config so a runtime change to
		// "Max Parallel Tasks" takes effect without restarting the daemon. Only the
		// project value is loaded with the board; fall back to global when it's unset.
		const effectiveLimit = state.projectConfig.maxParallelTasks ?? (await loadGlobalConfig()).maxParallelTasks;
		scheduler.setMaxParallelTasks(effectiveLimit);

		const board = state.board;
		const pendingCards: RuntimeBoardCard[] = [];

		// Gate pickup on the scheduler's in-memory state (running OR mid-launch), not the
		// board's terminalSessions. A card being launched is moved to in_progress only after
		// the slow worktree-create + install step, and the dev session is recorded later still
		// — so for that whole window it sits in todo/reopened with no session, and a session
		// based check re-dispatches it, spawning a second dev agent for the same card.
		// isHandlingTask covers that window via startingTasks.

		// Todo cards explicitly marked ready by the user
		const todoColumn = board.columns.find((c) => c.id === "todo");
		if (todoColumn) {
			for (const taskId of todoColumn.taskIds) {
				const card = board.cards[taskId];
				if (card?.readyForDev && !scheduler.isHandlingTask(taskId)) pendingCards.push(card);
			}
		}

		// Reopened cards are always eligible for re-pickup
		const reopenedColumn = board.columns.find((c) => c.id === "reopened");
		if (reopenedColumn) {
			for (const taskId of reopenedColumn.taskIds) {
				const card = board.cards[taskId];
				if (card && !scheduler.isHandlingTask(taskId)) pendingCards.push(card);
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
		let inFlightCount = board.columns.find((c) => c.id === "in_progress")?.taskIds.length ?? 0;

		for (const card of pendingCards) {
			if (!scheduler.canAcceptTask(inFlightCount)) break;
			// Skip cards whose relation gate isn't met yet:
			//   story    → every subtask in ready_for_review
			//   dependsOn → the single parent in ready_for_review
			//   waitsFor  → every listed card done (merged)
			const blocked =
				card.type === "story"
					? (card.subtaskIds ?? []).some((id) => board.cards[id]?.columnId !== "ready_for_review")
					: card.dependsOn
						? board.cards[card.dependsOn]?.columnId !== "ready_for_review"
						: (card.waitsFor ?? []).some((id) => board.cards[id]?.columnId !== "done");
			if (blocked) continue;
			logger.info(
				`[poller] Dispatching card "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" from ${card.columnId} (in-flight: ${inFlightCount}/${scheduler.maxParallelTasks})`,
			);
			inFlightCount++;
			await scheduler.startTask(card);
		}

		// Fallback for server restarts: in_progress cards with no active process (idle) that have
		// a dev comment mean the dev agent finished but review never started. Re-trigger review.
		// Skip cards the scheduler is mid-launch on: startTask moves the card to in_progress and
		// runs worktree setup/install before registering the dev terminal session, so a re-run card
		// (which already carries a prior dev comment) would otherwise match here and start review
		// concurrently with the launching dev agent.
		const inProgressCol = board.columns.find((c) => c.id === "in_progress");
		if (inProgressCol) {
			for (const taskId of inProgressCol.taskIds) {
				const card = board.cards[taskId];
				const hasDevComment = (card?.reviewComments ?? []).some((c) => c.type === "dev");
				if (
					card &&
					hasDevComment &&
					!card.terminalSessions?.some((ts) => !ts.endedAt) &&
					!scheduler.isHandlingTask(taskId)
				) {
					onCardReadyForReview(card);
				}
			}
		}

		// YOLO auto-delivery: in YOLO mode a card sitting in ready_for_review is
		// awaiting its merge — either the first attempt, or a deferred retry from
		// when the base branch was dirty. Re-attempt each tick; enqueueYoloMerge is
		// idempotent (in-flight guard) and defers cheaply if the base still isn't
		// ready, so the pile drains itself the moment the base is clean.
		if (state.projectConfig.deliveryMode === "yolo") {
			const readyCol = board.columns.find((c) => c.id === "ready_for_review");
			for (const taskId of readyCol?.taskIds ?? []) {
				const card = board.cards[taskId];
				if (card && card.type !== "subtask") {
					enqueueYoloMerge(repoPath, card, workspaceId, scheduler, stateHub);
				}
			}
		}
	}

	async pollPRs(): Promise<void> {
		const { workspaceId, repoPath, stateHub, scheduler } = this.options;

		const state = await loadWorkspaceState(workspaceId, repoPath);
		const rfr = state.board.columns.find((c) => c.id === "ready_for_review");
		if (!rfr) return;

		const cardsWithPR = rfr.taskIds.filter((id) => state.board.cards[id]?.pr?.url);
		if (cardsWithPR.length === 0) return;

		// Reload token fresh each poll cycle so config changes take effect immediately
		const githubToken = state.projectConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;

		for (const taskId of cardsWithPR) {
			const card = state.board.cards[taskId]!;
			const prUrlForPoll = card.pr!.url!;

			const info = await fetchPRInfo(prUrlForPoll, githubToken);
			if (!info) {
				logger.warn(
					`[poller] Could not fetch PR info for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" (${prUrlForPoll})`,
				);
				continue;
			}

			const seenIds = new Set(card.githubCommentIds ?? []);
			const allEntries = [...info.comments, ...info.reviews];
			const botEntries = allEntries.filter((e) => DEPLOYMENT_BOTS.has(e.author));
			const humanEntries = allEntries.filter((e) => !DEPLOYMENT_BOTS.has(e.author));

			// Mark bot IDs as seen so we never reprocess them
			const newBotIds = botEntries.filter((e) => !seenIds.has(e.id)).map((e) => e.id);
			if (newBotIds.length > 0) {
				for (const id of newBotIds) seenIds.add(id);
			}

			// Don't count comments with in-progress GitHub uploads as seen — recheck next poll
			const newEntries = humanEntries.filter((e) => !seenIds.has(e.id));
			const _pendingUploadEntries = newEntries.filter((e) => e.body.includes("![Uploading"));
			const readyEntries = newEntries.filter((e) => !e.body.includes("![Uploading"));

			let updated = false;

			// Strip any bot comments that snuck in before the filter was added
			const cleanedComments = (card.reviewComments ?? []).filter((c) => !DEPLOYMENT_BOTS.has(c.actor?.id ?? ""));
			const hadBotComments = cleanedComments.length !== (card.reviewComments ?? []).length;

			if (readyEntries.length > 0 || hadBotComments || newBotIds.length > 0) {
				const newComments = [
					...cleanedComments,
					...(await Promise.all(
						readyEntries.map(async (e) => {
							const fetchHtml = githubToken ? () => fetchCommentBodyHtml(prUrlForPoll, e.id, githubToken) : undefined;
							return {
								id: generateTaskId(),
								type: "human" as const,
								actor: { type: "external" as const, id: e.author, source: "github" },
								createdAt: new Date(e.createdAt).getTime(),
								summary: await downloadGithubImages(e.body, taskId, workspaceId, fetchHtml),
							};
						}),
					)),
				];
				const newIds = [...seenIds, ...readyEntries.map((e) => e.id)];
				await updateCard(workspaceId, taskId, { reviewComments: newComments, githubCommentIds: newIds });
				if (readyEntries.length > 0) {
					logger.info(
						`[poller] ${readyEntries.length} new comment(s) from GitHub PR for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}"`,
					);
					await appendActivityLog(workspaceId, taskId, `${readyEntries.length} new comment(s) imported from GitHub PR`);
					void playNotificationSound("prComment");
				}
				updated = true;
			}

			const authorCommented = readyEntries.some((e) => e.author === info.author);
			const changesRequested = info.reviewDecision === "CHANGES_REQUESTED";

			if (info.state === "MERGED") {
				logger.info(`[poller] PR merged for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" → Done`);
				await moveCard(workspaceId, taskId, "done");
				await clearCardSession(workspaceId, taskId);
				await appendActivityLog(workspaceId, taskId, "PR merged on GitHub → Done");
				void playNotificationSound("done");
				// Remove the shared worktree only once every card that uses it is done —
				// stacked children and story subtasks all share the owner's worktree and
				// would break if it were removed while any of them is still in flight.
				const boardAfterDone = await loadBoard(workspaceId);
				const ownerId = resolveWorktreeOwnerId(taskId, boardAfterDone.cards);
				const groupCards = Object.values(boardAfterDone.cards).filter(
					(c) => resolveWorktreeOwnerId(c.id, boardAfterDone.cards) === ownerId,
				);
				if (groupCards.every((c) => c.columnId === "done")) {
					await cleanupWorktree(ownerId, repoPath, boardAfterDone.cards[ownerId]?.branchName);
				}
				void syncMainRepoAfterPRMerge(repoPath, card.baseRef, card, workspaceId, scheduler, stateHub);
				updated = true;
			} else if (info.state === "CLOSED") {
				logger.info(
					`[poller] PR closed without merging for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" → Blocked`,
				);
				await moveCard(workspaceId, taskId, "blocked");
				await clearCardSession(workspaceId, taskId);
				await appendActivityLog(workspaceId, taskId, "PR closed without merging → Blocked");
				void playNotificationSound("blocked");
				updated = true;
			} else if (info.mergeable === "CONFLICTING") {
				if (!card.terminalSessions?.some((ts) => !ts.endedAt)) {
					logger.info(
						`[poller] PR has merge conflicts for "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}" → resolving`,
					);
					void resolvePRConflicts(repoPath, card, workspaceId, scheduler, stateHub);
					updated = true;
				}
			} else if (changesRequested || authorCommented) {
				const reason = changesRequested ? "Changes Requested review submitted" : `PR author (${info.author}) commented`;
				logger.info(`[poller] "${card.description?.split("\n")[0]?.slice(0, 60) ?? card.id}": ${reason} → Reopened`);
				await updateCard(workspaceId, taskId, { autoFixAttempts: 0 });
				await moveCard(workspaceId, taskId, "reopened");
				await appendActivityLog(workspaceId, taskId, `${reason} → Reopened`);
				await clearCardSession(workspaceId, taskId);
				void playNotificationSound("reopened");
				updated = true;
			}

			if (updated) stateHub.broadcastWorkspaceUpdate(workspaceId);
		}
	}
}
