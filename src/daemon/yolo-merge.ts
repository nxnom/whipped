import { existsSync } from "node:fs";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import {
	abortYoloMerge,
	baseRefSha,
	commitIfDirty,
	completeYoloMerge,
	pushBaseRef,
	remoteBaseBranchExists,
	startYoloMerge,
} from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { appendActivityLog, clearCardSession, loadBoard, moveCard } from "../state/workspace-state.js";
import {
	getCardBranch,
	getWorktreePath,
	removeWorktreeAsync,
	resolveWorktreeOwnerId,
} from "../worktree/worktree-manager.js";
import { enqueueMerge } from "./merge-queue.js";

// Structural subset of TaskScheduler. Declared here (rather than importing
// TaskScheduler) because scheduler.ts → review-pipeline.ts → this module, so a
// back-import would create a cycle.
export interface ConflictResolver {
	startConflictResolution(
		card: RuntimeBoardCard,
		mergeWorktreePath: string,
		conflictedFiles: string[],
		onComplete: (success: boolean) => Promise<void>,
	): Promise<void>;
}

const desc60 = (card: RuntimeBoardCard): string => card.description?.split("\n")[0]?.slice(0, 60) ?? card.id;

// All card IDs sharing one worktree: the owner + every card resolving to it.
function worktreeGroupIds(cardId: string, cards: Record<string, RuntimeBoardCard>): string[] {
	const ownerId = resolveWorktreeOwnerId(cardId, cards);
	const members = Object.values(cards)
		.filter((c) => resolveWorktreeOwnerId(c.id, cards) === ownerId)
		.map((c) => c.id);
	return [...new Set([ownerId, ...members])];
}

async function markGroupDone(
	workspaceId: string,
	ids: string[],
	cards: Record<string, RuntimeBoardCard>,
	logSuffix: string,
): Promise<void> {
	for (const id of ids) {
		const c = cards[id];
		if (c && c.columnId !== "done") {
			await moveCard(workspaceId, id, "done");
			await appendActivityLog(workspaceId, id, logSuffix);
		}
	}
}

// Cards whose merge is currently queued or running. Lets the poller re-attempt
// delivery every tick (for pending cards) without stacking duplicate merges.
const inFlight = new Set<string>();

// Cards whose merge attempt failed (conflict the agent couldn't resolve, or a
// non-conflict failure), keyed to the base sha at that attempt. While the base
// sits at the same sha there's nothing new to try, so we skip re-attempting (and
// crucially never re-spawn the conflict agent). The entry clears when the base
// advances — e.g. another card merges in — giving the card a fresh, free retry.
const attemptFailedAt = new Map<string, string>();

// Appends an activity entry only if it differs from the latest one, so repeated
// pending states don't spam the timeline. Broadcasts when it actually logs.
async function logPending(
	workspaceId: string,
	card: RuntimeBoardCard,
	board: { cards: Record<string, RuntimeBoardCard> },
	message: string,
	stateHub: RuntimeStateHub,
): Promise<void> {
	if (board.cards[card.id]?.activityLog?.at(-1)?.message === message) return;
	await appendActivityLog(workspaceId, card.id, message);
	stateHub.broadcastWorkspaceUpdate(workspaceId);
}

// Enqueues a YOLO merge for a review-passed card. Fire-and-forget and idempotent:
// the card is already in ready_for_review and moves to done once the merge lands.
// A no-op if this card is already queued/running. Merges into the same base ref
// run serially; different base refs run in parallel.
export function enqueueYoloMerge(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	resolver: ConflictResolver,
	stateHub: RuntimeStateHub,
): void {
	const key = `${workspaceId}:${card.id}`;
	if (inFlight.has(key)) return;
	inFlight.add(key);
	void enqueueMerge(`${workspaceId}:${card.baseRef}`, () =>
		runYoloMerge(repoPath, card, workspaceId, resolver, stateHub),
	)
		.catch((err) => logger.error({ err }, `[yolo] merge failed for "${desc60(card)}":`))
		.finally(() => inFlight.delete(key));
}

async function runYoloMerge(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	resolver: ConflictResolver,
	stateHub: RuntimeStateHub,
): Promise<void> {
	const baseRef = card.baseRef;
	const key = `${workspaceId}:${card.id}`;
	const baseSha = baseRefSha(repoPath, baseRef);

	// A prior attempt already failed against this exact base — nothing has changed,
	// so don't re-merge or (worse) re-spawn the conflict agent. Wait for the base to
	// advance, which clears this guard and grants a fresh retry.
	if (baseSha && attemptFailedAt.get(key) === baseSha) return;

	const board = await loadBoard(workspaceId);
	const ownerId = resolveWorktreeOwnerId(card.id, board.cards);
	const ownerWorktree = getWorktreePath(ownerId);
	const taskBranch = getCardBranch(card);

	// Make sure the latest work is committed onto the task branch before merging.
	if (existsSync(ownerWorktree)) {
		await commitIfDirty(ownerWorktree, card.pr?.title ?? desc60(card));
	}

	logger.info(`[yolo] Merging "${desc60(card)}" (${taskBranch}) into ${baseRef}`);
	const handle = startYoloMerge(repoPath, workspaceId, card.id, baseRef, taskBranch);

	// Deferred without touching anything (base checkout has uncommitted changes).
	// Stay in ready_for_review; the poller retries each tick and it merges the moment
	// the base is clean. Not recorded as a failure — this is cheap to keep checking.
	if (handle.deferred) {
		await logPending(workspaceId, card, board, `Delivery pending — ${handle.reason}`, stateHub);
		return;
	}

	if (handle.ok) {
		completeYoloMerge(repoPath, baseRef, handle);
		attemptFailedAt.delete(key);
		await finishYoloSuccess(repoPath, card, workspaceId, baseRef, stateHub);
		return;
	}

	// A non-conflict merge failure (e.g. an untracked file would be overwritten) has
	// no files for an agent to resolve. Stay pending and retry only when the base moves.
	if (handle.conflictedFiles.length === 0) {
		abortYoloMerge(repoPath, handle);
		if (baseSha) attemptFailedAt.set(key, baseSha);
		await logPending(
			workspaceId,
			card,
			board,
			"Delivery pending — merge failed (retries when the base changes)",
			stateHub,
		);
		return;
	}

	// Conflict — hand the merge worktree to the resolution agent. Hold the queue slot
	// (don't resolve) until the agent finishes, so no other card merges into this base
	// ref meanwhile. On failure: stay pending, recording the base sha so we don't
	// re-run the agent until the base advances.
	await appendActivityLog(
		workspaceId,
		card.id,
		`YOLO merge conflicts in: ${handle.conflictedFiles.join(", ")} — resolving...`,
	);
	stateHub.broadcastWorkspaceUpdate(workspaceId);

	await new Promise<void>((resolvePromise) => {
		void resolver
			.startConflictResolution(card, handle.worktreePath, handle.conflictedFiles, async (success) => {
				try {
					if (!success) {
						abortYoloMerge(repoPath, handle);
						if (baseSha) attemptFailedAt.set(key, baseSha);
						const reopened = await loadBoard(workspaceId);
						await logPending(
							workspaceId,
							card,
							reopened,
							"Delivery pending — unresolved merge conflict (retries when the base changes)",
							stateHub,
						);
						return;
					}
					completeYoloMerge(repoPath, baseRef, handle);
					attemptFailedAt.delete(key);
					await finishYoloSuccess(repoPath, card, workspaceId, baseRef, stateHub);
				} catch (err) {
					logger.error({ err }, `[yolo] conflict finalize failed for "${desc60(card)}":`);
				} finally {
					resolvePromise();
				}
			})
			.catch((err) => {
				logger.error({ err }, `[yolo] startConflictResolution failed for "${desc60(card)}":`);
				resolvePromise();
			});
	});
}

async function finishYoloSuccess(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	baseRef: string,
	stateHub: RuntimeStateHub,
): Promise<void> {
	if (remoteBaseBranchExists(repoPath, baseRef)) {
		const push = pushBaseRef(repoPath, baseRef);
		if (push.ok) {
			await appendActivityLog(workspaceId, card.id, `YOLO merged into ${baseRef} → pushed`);
		} else {
			await appendActivityLog(
				workspaceId,
				card.id,
				`YOLO merged into ${baseRef} locally, but push failed: ${push.error}`,
			);
			logger.warn(`[yolo] push of ${baseRef} failed for "${desc60(card)}": ${push.error}`);
		}
	} else {
		await appendActivityLog(workspaceId, card.id, `YOLO merged into ${baseRef} (local only)`);
	}

	const board = await loadBoard(workspaceId);
	const groupIds = worktreeGroupIds(card.id, board.cards);
	await markGroupDone(workspaceId, groupIds, board.cards, `Merged into ${baseRef} → Done`);
	for (const id of groupIds) await clearCardSession(workspaceId, id);

	// Remove the shared worktree only once every card using it is done — stacked
	// children and story subtasks share the owner's worktree.
	const boardAfter = await loadBoard(workspaceId);
	const ownerId = resolveWorktreeOwnerId(card.id, boardAfter.cards);
	const groupCards = Object.values(boardAfter.cards).filter(
		(c) => resolveWorktreeOwnerId(c.id, boardAfter.cards) === ownerId,
	);
	if (groupCards.every((c) => c.columnId === "done")) {
		try {
			await removeWorktreeAsync(ownerId, repoPath, boardAfter.cards[ownerId]?.branchName);
		} catch (err) {
			logger.error({ err }, `[yolo] worktree cleanup failed for ${ownerId}:`);
		}
	}
	stateHub.broadcastWorkspaceUpdate(workspaceId);
}
