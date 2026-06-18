import { spawnSync } from "node:child_process";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeBulkCardImportItem,
	RuntimeCardCreateRequest,
	RuntimeCardUpdateRequest,
	RuntimeReviewAttachment,
	RuntimeReviewComment,
	RuntimeReviewActor,
	RuntimeReviewIssue,
	RuntimeReviewStatus,
} from "../../core/api-contract.js";
import { logger } from "../../core/logger.js";
import { generateTaskId } from "../../core/task-id.js";
import { formatVisualElementsBlock } from "../../core/visual-comment.js";
import {
	abortMerge,
	attemptMerge,
	closePR,
	commitWorktree,
	createGithubPR,
	finalizeMerge,
	getCurrentBranch,
	isWorktreeDirty,
	listLocalBranches,
	listRemoteBranches,
	pushBranch,
} from "../../git/merge-operations.js";
import {
	appendActivityLog,
	clearCardSession,
	createCard,
	createCardsBulk,
	deleteCard,
	listWorkspaces,
	loadBoard,
	loadProjectConfig,
	loadWorkspaceState,
	moveCard,
	saveAttachment,
	updateCard,
} from "../../state/workspace-state.js";
import { slackNotifier } from "../../slack/slack-notifier.js";
import {
	getCardBranch,
	getDefaultBranch,
	getWorktreePath,
	removeWorktreeAsync,
	resolveWorktreeOwnerId,
} from "../../worktree/worktree-manager.js";
import { BadRequestError, InternalError, NotFoundError, PreconditionFailedError } from "../errors/http-errors.js";

// dependsOn (single-parent stacking) and waitsFor (many-parent gate) are mutually
// exclusive. When waitsFor is set, it wins and dependsOn is cleared.
const normalizeRelations = <T extends { dependsOn?: string; waitsFor?: string[] }>(data: T): T =>
	data.waitsFor && data.waitsFor.length > 0 ? { ...data, dependsOn: undefined } : data;

// Returns all card IDs that share one worktree: the owner + every card resolving to it.
const getStoryGroupCardIds = (cardId: string, cards: Record<string, RuntimeBoardCard>): string[] => {
	if (!cards[cardId]) return [cardId];
	const ownerId = resolveWorktreeOwnerId(cardId, cards);
	const members = Object.values(cards)
		.filter((c) => resolveWorktreeOwnerId(c.id, cards) === ownerId)
		.map((c) => c.id);
	return [...new Set([ownerId, ...members])];
};

// All worktree removals run serially in this queue so they never block the
// event loop (each step uses async I/O) and never contend on the git lock.
const cleanupQueue: (() => Promise<void>)[] = [];
let cleanupRunning = false;

const drainCleanupQueue = async (): Promise<void> => {
	cleanupRunning = true;
	while (cleanupQueue.length > 0) {
		const task = cleanupQueue.shift()!;
		try {
			await task();
		} catch (err) {
			logger.error({ err }, "[cleanup] unexpected error:");
		}
	}
	cleanupRunning = false;
};

const enqueueCleanup = (fn: () => Promise<void>): void => {
	cleanupQueue.push(fn);
	if (!cleanupRunning) drainCleanupQueue();
};

export const createCardService = async (
	workspaceId: string,
	cardData: Omit<RuntimeCardCreateRequest, "baseRef">,
	requestedBase: string | undefined,
): Promise<RuntimeBoardCard> => {
	try {
		const workspaces = await listWorkspaces();
		const ws = workspaces.find((w) => w.workspaceId === workspaceId);
		if (!ws) throw NotFoundError("Workspace");
		const config = await loadProjectConfig(workspaceId);
		const baseRef = requestedBase || config.defaultBaseBranch || getDefaultBranch(ws.repoPath);
		const { visualComment, ...rest } = cardData;
		const block = visualComment ? formatVisualElementsBlock(visualComment.elements, visualComment.pageUrl) : "";
		const description = block ? `${rest.description}\n\n${block}` : rest.description;
		return await createCard(workspaceId, normalizeRelations({ ...rest, description }), baseRef);
	} catch (err) {
		logger.error(
			`[cards.create] Error creating card: ${String(err)}\nInput: ${JSON.stringify({ workspaceId, ...cardData, baseRef: requestedBase })}\nStack: ${err instanceof Error ? err.stack : ""}`,
		);
		throw err;
	}
};

export interface BulkImportRowError {
	index: number;
	message: string;
}

// Validates a whole import batch up front and creates it atomically (all-or-nothing).
// Rejects with per-row errors if anything is off: no task workflow configured, a
// story/subtask without a story workflow, an empty description, or a dependency
// reference that names neither a sibling tempId nor an existing card.
export const bulkCreateCardsService = async (
	workspaceId: string,
	items: RuntimeBulkCardImportItem[],
	requestedBase: string | undefined,
): Promise<{ cards: RuntimeBoardCard[] }> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const config = await loadProjectConfig(workspaceId);
	if (config.workflows.filter((w) => !w.forStory).length === 0) {
		throw BadRequestError("Create at least one workflow before importing tickets.");
	}
	const hasStoryWorkflow = config.workflows.some((w) => w.forStory);

	const board = await loadBoard(workspaceId);
	const existingCardIds = new Set(Object.keys(board.cards));
	const tempIds = new Set(items.map((it) => it.tempId).filter((t): t is string => Boolean(t)));

	const errors: BulkImportRowError[] = [];
	items.forEach((item, index) => {
		if (!item.description?.trim()) errors.push({ index, message: "description is required" });
		if ((item.type === "story" || item.type === "subtask") && !hasStoryWorkflow) {
			errors.push({ index, message: "story/subtask tickets require a story workflow — create one first" });
		}
		const refs = [...(item.dependsOn ? [item.dependsOn] : []), ...(item.waitsFor ?? []), ...(item.subtaskIds ?? [])];
		for (const ref of refs) {
			if (!tempIds.has(ref) && !existingCardIds.has(ref)) {
				errors.push({ index, message: `unknown reference "${ref}"` });
			}
		}
	});
	if (errors.length > 0) throw BadRequestError("Import validation failed", errors);

	const baseRef = requestedBase || config.defaultBaseBranch || getDefaultBranch(ws.repoPath);
	const cards = await createCardsBulk(workspaceId, items, baseRef);
	return { cards };
};

export const listBranchesService = async (
	workspaceId: string,
	remote = false,
): Promise<{ branches: string[]; defaultBranch: string }> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) return { branches: [], defaultBranch: "main" };
	const config = await loadProjectConfig(workspaceId);
	const defaultBranch = config.defaultBaseBranch ?? getDefaultBranch(ws.repoPath);
	const branches = remote
		? listRemoteBranches(ws.repoPath).filter((b) => b !== getCurrentBranch(ws.repoPath))
		: listLocalBranches(ws.repoPath);
	return { branches, defaultBranch };
};

export type CommitAndMergeResult =
	| { status: "needs_commit" }
	| { status: "merged" }
	| {
			status: "resolving_conflicts";
			card: RuntimeBoardCard;
			repoPath: string;
			taskBranch: string;
			conflictedFiles: string[];
			storyGroupIds: string[];
			mergeBoardCards: Record<string, RuntimeBoardCard>;
			sharedPrUrl: string | undefined;
			githubToken: string | undefined;
	  };

// Closes the shared PR (best-effort) when the story group resolves.
const closeSharedPR = (sharedPrUrl: string | undefined, githubToken: string | undefined): void => {
	if (sharedPrUrl && githubToken) {
		closePR(sharedPrUrl, githubToken).catch((err) => {
			logger.warn(`[merge] Failed to close PR ${sharedPrUrl}: ${String(err)}`);
		});
	}
};

// Moves every still-open card in the story group to Done and logs the move.
const markStoryGroupDone = async (
	workspaceId: string,
	storyGroupIds: string[],
	cards: Record<string, RuntimeBoardCard>,
	logSuffix: string,
): Promise<void> => {
	for (const relId of storyGroupIds) {
		const relCard = cards[relId];
		if (relCard && relCard.columnId !== "done") {
			await moveCard(workspaceId, relId, "done");
			await appendActivityLog(workspaceId, relId, logSuffix);
		}
	}
};

// Emergency stop: kill every live agent, park in_progress/reopened cards back in
// Todo, and clear readyForDev everywhere so the always-on poller stops dispatching.
// Worktrees are preserved so a later resume continues prior work. ready_for_review /
// done / blocked cards are left untouched.
export const stopAllService = async (
	workspaceId: string,
	stopTask: (cardId: string) => void,
): Promise<{ stoppedCardIds: string[] }> => {
	const board = await loadBoard(workspaceId);
	const activeIds = Object.values(board.cards)
		.filter((c) => c.columnId === "in_progress" || c.columnId === "reopened")
		.map((c) => c.id);

	for (const id of activeIds) {
		stopTask(id);
		await updateCard(workspaceId, id, { readyForDev: false });
		await moveCard(workspaceId, id, "todo");
		await appendActivityLog(workspaceId, id, "Stopped by Stop All → Todo");
	}

	const refreshed = await loadBoard(workspaceId);
	for (const card of Object.values(refreshed.cards)) {
		if (card.columnId === "todo" && card.readyForDev) {
			await updateCard(workspaceId, card.id, { readyForDev: false });
		}
	}

	return { stoppedCardIds: activeIds };
};

// One-click resume: mark every Todo card readyForDev so the poller picks them up.
export const resumeAllService = async (workspaceId: string): Promise<{ resumedCardIds: string[] }> => {
	const board = await loadBoard(workspaceId);
	const ids = Object.values(board.cards)
		.filter((c) => c.columnId === "todo" && !c.readyForDev)
		.map((c) => c.id);
	for (const id of ids) {
		await updateCard(workspaceId, id, { readyForDev: true });
	}
	return { resumedCardIds: ids };
};

export const commitAndMergeService = async (
	workspaceId: string,
	cardId: string,
	commitMessage: string | undefined,
): Promise<CommitAndMergeResult> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");
	if (card.columnId !== "ready_for_review") {
		throw BadRequestError("Card is not in Ready for Review");
	}

	const effectiveWorktreeId = resolveWorktreeOwnerId(cardId, board.cards);
	const worktreePath = getWorktreePath(effectiveWorktreeId);
	const taskBranch = getCardBranch(card);

	const mergeConfig = await loadProjectConfig(workspaceId);

	const dirty = await isWorktreeDirty(worktreePath);
	if (dirty) {
		if (!commitMessage) {
			return { status: "needs_commit" };
		}
		await commitWorktree(worktreePath, commitMessage);
	}

	let mergeResult: ReturnType<typeof attemptMerge>;
	try {
		mergeResult = attemptMerge(ws.repoPath, effectiveWorktreeId, taskBranch);
	} catch (err) {
		throw InternalError(String(err));
	}

	const mergeGithubToken = mergeConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;

	// Collect all cards in the same story group (this card + siblings + story/owner).
	const mergeBoard = await loadBoard(workspaceId);
	const storyGroupIds = getStoryGroupCardIds(cardId, mergeBoard.cards);
	const sharedPrUrl = storyGroupIds.map((id) => mergeBoard.cards[id]?.pr?.url).find(Boolean);

	if (mergeResult.ok) {
		closeSharedPR(sharedPrUrl, mergeGithubToken);
		await markStoryGroupDone(workspaceId, storyGroupIds, mergeBoard.cards, `Merged into ${card.baseRef} → Done`);
		return { status: "merged" };
	}

	if (mergeResult.dirtyBase) {
		throw PreconditionFailedError(
			"Cannot merge: the base branch has uncommitted or staged changes. Commit or stash them first.",
		);
	}

	// Conflicts in the main repo — caller spawns the conflict-resolution agent.
	await appendActivityLog(
		workspaceId,
		cardId,
		`Merge conflicts in: ${mergeResult.conflictedFiles.join(", ")} — resolving...`,
	);

	return {
		status: "resolving_conflicts",
		card,
		repoPath: ws.repoPath,
		taskBranch,
		conflictedFiles: mergeResult.conflictedFiles,
		storyGroupIds,
		mergeBoardCards: mergeBoard.cards,
		sharedPrUrl,
		githubToken: mergeGithubToken,
	};
};

// Data work for the conflict-resolution callback (no broadcast — caller broadcasts).
export const finishConflictResolutionService = async (
	workspaceId: string,
	cardId: string,
	repoPath: string,
	taskBranch: string,
	baseRef: string,
	storyGroupIds: string[],
	mergeBoardCards: Record<string, RuntimeBoardCard>,
	sharedPrUrl: string | undefined,
	githubToken: string | undefined,
	success: boolean,
): Promise<void> => {
	if (success) {
		finalizeMerge(repoPath, taskBranch);
		closeSharedPR(sharedPrUrl, githubToken);
		await markStoryGroupDone(
			workspaceId,
			storyGroupIds,
			mergeBoardCards,
			`Conflicts resolved → merged into ${baseRef} → Done`,
		);
		return;
	}
	abortMerge(repoPath);
	await moveCard(workspaceId, cardId, "blocked");
	await appendActivityLog(workspaceId, cardId, "Could not resolve merge conflicts → Blocked");
	await clearCardSession(workspaceId, cardId);
};

// Aborts the in-progress merge (used when no scheduler is available to resolve).
export const abortMergeService = (repoPath: string): void => {
	abortMerge(repoPath);
};

export type CommitAndPRResult =
	| { status: "no_token" }
	| { status: "needs_commit" }
	| { status: "pr_created"; prUrl: string };

export const commitAndPRService = async (
	workspaceId: string,
	cardId: string,
	commitMessage: string | undefined,
	baseRef?: string,
): Promise<CommitAndPRResult> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");
	if (card.columnId !== "ready_for_review") {
		throw BadRequestError("Card is not in Ready for Review");
	}

	const prProjectConfig = await loadProjectConfig(workspaceId);
	const prGithubToken = prProjectConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;
	if (!prGithubToken) {
		logger.warn(`[commitAndPR] GITHUB_TOKEN not set for workspace ${workspaceId} — PR creation skipped`);
		return { status: "no_token" };
	}

	const prWorktreePath = getWorktreePath(resolveWorktreeOwnerId(cardId, board.cards));
	const taskBranch = getCardBranch(card);

	const dirty = await isWorktreeDirty(prWorktreePath);
	if (dirty) {
		if (!commitMessage) {
			return { status: "needs_commit" };
		}
		await commitWorktree(prWorktreePath, commitMessage);
	}

	// Collect all cards in the same story group to deduplicate and propagate the PR URL.
	const prBoard = await loadBoard(workspaceId);
	const prGroupIds = getStoryGroupCardIds(cardId, prBoard.cards);
	const existingPrUrl = prGroupIds.map((id) => prBoard.cards[id]?.pr?.url).find(Boolean);

	let prUrl: string;
	if (existingPrUrl) {
		// Branch already has a PR — reuse it and propagate to any card that missed it.
		prUrl = existingPrUrl;
	} else {
		try {
			await pushBranch(prWorktreePath, taskBranch);
		} catch (err) {
			throw InternalError(`Push failed: ${err}`);
		}

		// Use the story/owner card's PR metadata when available for a unified PR title.
		const ownerCard = prBoard.cards[resolveWorktreeOwnerId(cardId, prBoard.cards)];
		const devSummary =
			[...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.summary ?? card.description;
		const prTitle =
			ownerCard?.pr?.title ?? card.pr?.title ?? (ownerCard ?? card).description?.split("\n")[0]?.slice(0, 72) ?? cardId;
		const prDescription = ownerCard?.pr?.description ?? card.pr?.description ?? devSummary;

		try {
			prUrl = await createGithubPR(prWorktreePath, prTitle, prDescription, baseRef || card.baseRef, prGithubToken);
		} catch (err) {
			spawnSync("git", ["push", "origin", "--delete", taskBranch], { cwd: prWorktreePath, stdio: "ignore" });
			throw InternalError(`PR creation failed: ${err}`);
		}
	}

	// Propagate PR URL to all cards in the story group (story + all subtasks).
	for (const relId of prGroupIds) {
		const relCard = prBoard.cards[relId];
		if (relCard && !relCard.pr?.url) {
			await updateCard(workspaceId, relId, { pr: { ...(relCard.pr ?? {}), url: prUrl } });
		}
	}
	await appendActivityLog(workspaceId, cardId, `PR ${existingPrUrl ? "linked" : "created"} → ${prUrl}`);
	return { status: "pr_created", prUrl };
};

export const updateCardService = async (
	workspaceId: string,
	cardId: string,
	update: Omit<RuntimeCardUpdateRequest, "cardId" | "revision">,
): Promise<RuntimeBoardCard> => {
	try {
		return await updateCard(workspaceId, cardId, normalizeRelations(update));
	} catch (err) {
		logger.error(
			`[cards.update] Error updating card ${cardId}: ${String(err)}\nUpdate: ${JSON.stringify(update)}\nStack: ${err instanceof Error ? err.stack : ""}`,
		);
		throw err;
	}
};

export type MoveCardResult = {
	board: RuntimeBoardData;
	// Card + board snapshot the caller needs to trigger the reopen cascade (only set for "reopened").
	reopenCascade?: { movedCard: RuntimeBoardCard; boardCards: Record<string, RuntimeBoardCard> };
};

export const moveCardService = async (
	workspaceId: string,
	cardId: string,
	targetColumnId: RuntimeBoardColumnId,
	targetIndex: number | undefined,
): Promise<MoveCardResult> => {
	const board = await moveCard(workspaceId, cardId, targetColumnId, targetIndex);
	// Clear session so the poller can pick up cards moved back to work columns
	if (targetColumnId === "reopened" || targetColumnId === "todo") {
		await clearCardSession(workspaceId, cardId);
	}
	if (targetColumnId === "reopened") {
		await updateCard(workspaceId, cardId, { autoFixAttempts: 0 });
		const movedBoard = await loadBoard(workspaceId);
		const movedCard = movedBoard.cards[cardId];
		if (movedCard) {
			return { board, reopenCascade: { movedCard, boardCards: movedBoard.cards } };
		}
	}
	return { board };
};

export type DeleteCardResult = {
	ok: true;
	// Card snapshot the caller needs to schedule background cleanup / Slack notify.
	deletedCard: RuntimeBoardCard | undefined;
	repoPath: string;
};

export const deleteCardService = async (
	workspaceId: string,
	cardId: string,
	repoPath: string,
): Promise<DeleteCardResult> => {
	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];

	// Resolve worktree ownership from the pre-deletion board: only remove the worktree
	// if this card owned it and no surviving card still shares it.
	const ownsWorktree = !!card && resolveWorktreeOwnerId(cardId, board.cards) === cardId;
	const sharedByOthers =
		ownsWorktree &&
		Object.values(board.cards).some((c) => c.id !== cardId && resolveWorktreeOwnerId(c.id, board.cards) === cardId);

	await Promise.all([deleteCard(workspaceId, cardId), clearCardSession(workspaceId, cardId)]);
	if (card && card.columnId !== "done") {
		void slackNotifier.notifyCardDeleted(card);
	}

	// Queue cleanup so it never blocks the event loop
	enqueueCleanup(async () => {
		logger.info(`[cleanup:${cardId}] dequeued (${cleanupQueue.length} remaining)`);
		if (card?.pr?.url) {
			const deletePrUrl = card.pr.url;
			const deleteProjectConfig = await loadProjectConfig(workspaceId).catch(() => null);
			const deleteGithubToken = deleteProjectConfig?.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;
			if (deleteGithubToken) {
				await closePR(deletePrUrl, deleteGithubToken).catch((err) => {
					logger.warn(`[cleanup:${cardId}] closePR failed: ${String(err)}`);
				});
			}
		}
		if (ownsWorktree && !sharedByOthers) {
			await removeWorktreeAsync(cardId, repoPath, card?.branchName);
		}
	});

	return { ok: true, deletedCard: card, repoPath };
};

export interface AddReviewCommentInput {
	workspaceId: string;
	cardId: string;
	type: string;
	actor: RuntimeReviewActor;
	status?: RuntimeReviewStatus;
	streamId?: string;
	summary: string;
	issues?: RuntimeReviewIssue[];
	attachments?: RuntimeReviewAttachment[];
	metadata?: Record<string, unknown>;
	createdAt?: number;
}

export const addReviewCommentService = async (
	input: AddReviewCommentInput,
): Promise<{ ok: true; comment: RuntimeReviewComment }> => {
	const board = await loadBoard(input.workspaceId);
	const card = board.cards[input.cardId];
	if (!card) throw NotFoundError("Card");

	// Process attachments: read each file and save to canonical store
	let processedAttachments = input.attachments;
	if (input.attachments?.length) {
		const { readFile } = await import("node:fs/promises");
		processedAttachments = [];
		for (const att of input.attachments) {
			try {
				const data = await readFile(att.path);
				const ext = att.path.split(".").pop() ?? "bin";
				const canonicalPath = await saveAttachment(data, ext, input.cardId);
				processedAttachments.push({ ...att, path: canonicalPath });
			} catch {
				processedAttachments.push(att);
			}
		}
	}

	const comment: RuntimeReviewComment = {
		id: generateTaskId(),
		type: input.type,
		actor: input.actor,
		status: input.status,
		createdAt: input.createdAt ?? Date.now(),
		streamId: input.streamId,
		summary: input.summary,
		issues: input.issues,
		attachments: processedAttachments,
		metadata: input.metadata,
	};
	const updatedComments = [...(card.reviewComments ?? []), comment];
	await updateCard(input.workspaceId, input.cardId, { reviewComments: updatedComments });
	return { ok: true, comment };
};

export interface DeleteReviewCommentInput {
	workspaceId: string;
	cardId: string;
	commentId: string;
}

export const deleteReviewCommentService = async (input: DeleteReviewCommentInput): Promise<{ ok: true }> => {
	const board = await loadBoard(input.workspaceId);
	const card = board.cards[input.cardId];
	if (!card) throw NotFoundError("Card");

	const comments = card.reviewComments ?? [];
	const next = comments.filter((c) => c.id !== input.commentId);
	if (next.length === comments.length) throw NotFoundError("Comment");

	await updateCard(input.workspaceId, input.cardId, { reviewComments: next });
	return { ok: true };
};

export type SubmitHumanFeedbackResult = {
	ok: true;
	// Card + board snapshot the caller needs to trigger the reopen cascade.
	reopenCascade?: { feedbackCard: RuntimeBoardCard; boardCards: Record<string, RuntimeBoardCard> };
};

export const submitHumanFeedbackService = async (
	workspaceId: string,
	cardId: string,
	comment: string | undefined,
	attachments: RuntimeReviewAttachment[] | undefined,
	type?: string,
	metadata?: Record<string, unknown>,
): Promise<SubmitHumanFeedbackResult> => {
	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");

	const trimmed = comment?.trim();
	const hasContent = trimmed || (attachments?.length ?? 0) > 0 || metadata != null;
	const updatedComments = hasContent
		? [
				...(card.reviewComments ?? []),
				{
					id: generateTaskId(),
					type: type ?? "human",
					actor: { type: "human" as const, id: "human" },
					createdAt: Date.now(),
					summary: trimmed ?? "Feedback with attachments",
					attachments: attachments?.length ? attachments : undefined,
					...(metadata ? { metadata } : {}),
				},
			]
		: (card.reviewComments ?? []);
	await updateCard(workspaceId, cardId, { reviewComments: updatedComments, autoFixAttempts: 0 });
	await moveCard(workspaceId, cardId, "reopened");
	await clearCardSession(workspaceId, cardId);
	await appendActivityLog(workspaceId, cardId, "Human feedback submitted → moved to Reopened");

	const feedbackBoard = await loadBoard(workspaceId);
	const feedbackCard = feedbackBoard.cards[cardId];
	if (feedbackCard) {
		return { ok: true, reopenCascade: { feedbackCard, boardCards: feedbackBoard.cards } };
	}
	return { ok: true };
};

// Validates the card for an agent start and returns it; caller drives the scheduler.
export const prepareStartAgentService = async (workspaceId: string, cardId: string): Promise<RuntimeBoardCard> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");
	const state = await loadWorkspaceState(workspaceId, ws.repoPath);
	const card = state.board.cards[cardId];
	if (!card) throw NotFoundError("Card");
	await updateCard(workspaceId, cardId, { autoFixAttempts: 0 });
	return card;
};

export const setPrMetaService = async (
	workspaceId: string,
	cardId: string,
	title: string | undefined,
	description: string | undefined,
	updatedBy: string | undefined,
): Promise<{ ok: true; pr: NonNullable<RuntimeBoardCard["pr"]> }> => {
	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");

	// Merge title/description into card.pr — preserves url (daemon owns it).
	const nextPr = {
		...card.pr,
		...(title !== undefined ? { title } : {}),
		...(description !== undefined ? { description } : {}),
		updatedAt: Date.now(),
		...(updatedBy ? { updatedBy } : {}),
	};
	await updateCard(workspaceId, cardId, { pr: nextPr });
	return { ok: true, pr: nextPr };
};

export const setPlanService = async (workspaceId: string, cardId: string, plan: string): Promise<{ ok: true }> => {
	const board = await loadBoard(workspaceId);
	if (!board.cards[cardId]) throw NotFoundError("Card");
	await updateCard(workspaceId, cardId, { plan });
	return { ok: true };
};

export const getDiffService = async (
	workspaceId: string,
	cardId: string,
): Promise<{ diff: string | null; error: string | null; baseBehindCount?: number }> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");

	const worktreePath = getWorktreePath(resolveWorktreeOwnerId(cardId, board.cards));
	const { existsSync } = await import("node:fs");
	if (!existsSync(worktreePath)) {
		return { diff: null, error: "No worktree — agent has not started yet" };
	}

	const committedResult = spawnSync("git", ["diff", `${card.baseRef}...HEAD`, "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: 4 * 1024 * 1024,
	});

	if (committedResult.status !== 0 && committedResult.stderr) {
		return { diff: null, error: committedResult.stderr.trim() };
	}

	// Also include staged and unstaged changes so the diff is accurate
	// regardless of whether auto-commit is on or off.
	const stagedResult = spawnSync("git", ["diff", "--cached", "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: 4 * 1024 * 1024,
	});
	const unstagedResult = spawnSync("git", ["diff", "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: 4 * 1024 * 1024,
	});

	// Include untracked new files as synthetic diffs — they're invisible to all
	// git diff variants but are real changes when auto-commit is disabled.
	const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const untrackedFiles = (untrackedResult.stdout ?? "")
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);
	const { readFileSync } = await import("node:fs");
	const untrackedDiffs = untrackedFiles
		.map((file) => {
			try {
				const content = readFileSync(`${worktreePath}/${file}`, "utf-8");
				const lines = content.split("\n");
				const addedLines = lines.map((l, _i) => `+${l}`).join("\n");
				const hunkHeader = `@@ -0,0 +1,${lines.length} @@`;
				return `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${hunkHeader}\n${addedLines}`;
			} catch {
				return null;
			}
		})
		.filter((d): d is string => d !== null);

	const diff = [committedResult.stdout, stagedResult.stdout, unstagedResult.stdout, ...untrackedDiffs]
		.filter((s) => s?.trim())
		.join("\n");

	const behindResult = spawnSync("git", ["rev-list", "--count", `HEAD..${card.baseRef}`], {
		cwd: worktreePath,
		encoding: "utf-8",
	});
	const baseBehindCount = parseInt(behindResult.stdout?.trim() ?? "0", 10) || 0;

	return { diff, error: null, baseBehindCount };
};

export interface CommitEntry {
	hash: string;
	shortHash: string;
	message: string;
	author: string;
	date: string;
}

export const getCommitsService = async (workspaceId: string, cardId: string): Promise<{ commits: CommitEntry[] }> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");

	const worktreePath = getWorktreePath(resolveWorktreeOwnerId(cardId, board.cards));
	const { existsSync } = await import("node:fs");
	if (!existsSync(worktreePath)) return { commits: [] };

	const result = spawnSync("git", ["log", "--pretty=format:%H%x00%h%x00%s%x00%an%x00%ai", `${card.baseRef}..HEAD`], {
		cwd: worktreePath,
		encoding: "utf-8",
	});

	if (result.status !== 0 || !result.stdout?.trim()) return { commits: [] };

	const commits = result.stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [hash = "", shortHash = "", message = "", author = "", date = ""] = line.split("\x00");
			return { hash, shortHash, message, author, date };
		});

	return { commits };
};

export const getDiffForCommitService = async (
	workspaceId: string,
	cardId: string,
	commitHash: string,
): Promise<{ diff: string | null; error: string | null }> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) throw NotFoundError("Card");

	if (!/^[0-9a-f]{4,64}$/i.test(commitHash)) return { diff: null, error: "Invalid commit hash" };

	const worktreePath = getWorktreePath(resolveWorktreeOwnerId(cardId, board.cards));
	const { existsSync } = await import("node:fs");
	if (!existsSync(worktreePath)) return { diff: null, error: "No worktree" };

	const result = spawnSync("git", ["show", commitHash, "--format=", "--patch", "--no-color", "-U3"], {
		cwd: worktreePath,
		encoding: "utf-8",
		maxBuffer: 4 * 1024 * 1024,
	});

	if (result.status !== 0) {
		return { diff: null, error: result.stderr?.trim() ?? "Failed to get commit diff" };
	}

	return { diff: result.stdout.replace(/^\n+/, ""), error: null };
};
