import { existsSync } from "node:fs";
import type { RuntimeBoardCard } from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import {
	abortYoloMerge,
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
	removeWorktree,
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

// Enqueues a YOLO merge for a review-passed card. Fire-and-forget: the card is
// already in ready_for_review and moves to done once the merge lands. Merges into
// the same base ref run serially; different base refs run in parallel.
export function enqueueYoloMerge(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	resolver: ConflictResolver,
	stateHub: RuntimeStateHub,
): void {
	void enqueueMerge(`${workspaceId}:${card.baseRef}`, () =>
		runYoloMerge(repoPath, card, workspaceId, resolver, stateHub),
	).catch((err) => logger.error({ err }, `[yolo] merge failed for "${desc60(card)}":`));
}

async function runYoloMerge(
	repoPath: string,
	card: RuntimeBoardCard,
	workspaceId: string,
	resolver: ConflictResolver,
	stateHub: RuntimeStateHub,
): Promise<void> {
	const baseRef = card.baseRef;
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

	if (handle.ok) {
		completeYoloMerge(repoPath, baseRef, handle);
		await finishYoloSuccess(repoPath, card, workspaceId, baseRef, stateHub);
		return;
	}

	// A non-conflict merge failure (e.g. the in-place tree couldn't be written) has
	// no files to resolve — abort and bail rather than spawn an agent on nothing.
	if (handle.conflictedFiles.length === 0) {
		abortYoloMerge(repoPath, handle);
		await moveCard(workspaceId, card.id, "blocked");
		await appendActivityLog(workspaceId, card.id, "YOLO merge failed (no conflicts to resolve) → Blocked");
		await clearCardSession(workspaceId, card.id);
		stateHub.broadcastWorkspaceUpdate(workspaceId);
		return;
	}

	// Conflict — hand the merge worktree to the resolution agent. Hold the queue
	// slot (don't resolve) until the agent finishes, so no other card merges into
	// this base ref meanwhile.
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
						await moveCard(workspaceId, card.id, "blocked");
						await appendActivityLog(workspaceId, card.id, "Could not resolve YOLO merge conflicts → Blocked");
						await clearCardSession(workspaceId, card.id);
						stateHub.broadcastWorkspaceUpdate(workspaceId);
						return;
					}
					completeYoloMerge(repoPath, baseRef, handle);
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
			removeWorktree(ownerId, repoPath, boardAfter.cards[ownerId]?.branchName);
		} catch (err) {
			logger.error({ err }, `[yolo] worktree cleanup failed for ${ownerId}:`);
		}
	}
	stateHub.broadcastWorkspaceUpdate(workspaceId);
}
