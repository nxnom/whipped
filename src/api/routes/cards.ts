import { Hono } from "hono";
import { z } from "zod";
import {
	reviewActorSchema,
	reviewAttachmentSchema,
	reviewIssueSchema,
	runtimeBulkCardsCreateRequestSchema,
	runtimeCardCreateRequestSchema,
	runtimeCardMoveRequestSchema,
	runtimeCardUpdateRequestSchema,
} from "../../core/api-contract.js";
import { InternalError } from "../errors/http-errors.js";
import { zv } from "../middleware/zv.js";
import {
	abortMergeService,
	addReviewCommentService,
	bulkCreateCardsService,
	deleteReviewCommentService,
	commitAndMergeService,
	commitAndPRService,
	createCardService,
	deleteCardService,
	finishConflictResolutionService,
	getCommitsService,
	getDiffForCommitService,
	getDiffService,
	listBranchesService,
	moveCardService,
	prepareStartAgentService,
	resumeAllService,
	setPlanService,
	setPrMetaService,
	stopAllService,
	submitHumanFeedbackService,
	updateCardService,
} from "../services/cards-service.js";
import type { AppEnv } from "../types/context.js";

export const cardsController = new Hono<AppEnv>()
	.post("/", zv("json", runtimeCardCreateRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, baseRef, ...cardData } = c.req.valid("json");
		const card = await createCardService(workspaceId, cardData, baseRef);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(card);
	})
	.post("/bulk", zv("json", runtimeBulkCardsCreateRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, baseRef, cards } = c.req.valid("json");
		const result = await bulkCreateCardsService(workspaceId, cards, baseRef);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	})
	.get(
		"/branches",
		zv("query", z.object({ workspaceId: z.string(), remote: z.enum(["true", "false"]).optional() })),
		async (c) => {
			const { workspaceId, remote } = c.req.valid("query");
			return c.json(await listBranchesService(workspaceId, remote === "true"));
		},
	)
	.post("/stop-all", zv("json", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("json");
		const scheduler = ctx.getScheduler(workspaceId);
		const result = await stopAllService(workspaceId, (cardId) => scheduler?.stopTask(cardId));
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	})
	.post("/resume-all", zv("json", z.object({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId } = c.req.valid("json");
		const result = await resumeAllService(workspaceId);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result);
	})
	.post(
		"/commit-and-merge",
		zv("json", z.object({ workspaceId: z.string(), cardId: z.string(), commitMessage: z.string().optional() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, commitMessage } = c.req.valid("json");
			const result = await commitAndMergeService(workspaceId, cardId, commitMessage);

			if (result.status === "needs_commit") {
				return c.json({ status: "needs_commit" as const });
			}

			if (result.status === "merged") {
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return c.json({ status: "merged" as const });
			}

			// Conflicts in the main repo — spawn conflict resolution agent.
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);

			const scheduler = ctx.getScheduler(workspaceId);
			if (!scheduler) {
				abortMergeService(result.repoPath);
				throw InternalError("Scheduler not ready");
			}

			await scheduler.startConflictResolution(result.card, result.repoPath, result.conflictedFiles, async (success) => {
				await finishConflictResolutionService(
					workspaceId,
					cardId,
					result.repoPath,
					result.taskBranch,
					result.card.baseRef,
					result.storyGroupIds,
					result.mergeBoardCards,
					result.sharedPrUrl,
					result.githubToken,
					success,
				);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			});

			return c.json({ status: "resolving_conflicts" as const });
		},
	)
	.post(
		"/commit-and-pr",
		zv(
			"json",
			z.object({
				workspaceId: z.string(),
				cardId: z.string(),
				commitMessage: z.string().optional(),
				baseRef: z.string().optional(),
			}),
		),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, commitMessage, baseRef } = c.req.valid("json");
			const result = await commitAndPRService(workspaceId, cardId, commitMessage, baseRef);
			if (result.status === "pr_created") {
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			}
			return c.json(result);
		},
	)
	.patch(
		"/:id",
		zv("param", z.object({ id: z.string() })),
		zv("json", runtimeCardUpdateRequestSchema.extend({ workspaceId: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, revision, ...update } = c.req.valid("json");
			const card = await updateCardService(workspaceId, cardId, update);
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			return c.json(card);
		},
	)
	.post("/move", zv("json", runtimeCardMoveRequestSchema.extend({ workspaceId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, cardId, targetColumnId, targetIndex } = c.req.valid("json");
		const result = await moveCardService(workspaceId, cardId, targetColumnId, targetIndex);
		if (result.reopenCascade) {
			const scheduler = ctx.getScheduler(workspaceId);
			if (scheduler) {
				void scheduler.triggerParentReopenCascade(result.reopenCascade.movedCard, result.reopenCascade.boardCards);
			}
		}
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json(result.board);
	})
	.delete(
		"/:id",
		zv("param", z.object({ id: z.string() })),
		zv("json", z.object({ workspaceId: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { id: cardId } = c.req.valid("param");
			const { workspaceId } = c.req.valid("json");
			ctx.getScheduler(workspaceId)?.stopTask(cardId);
			const ws = await ctx.ensureWorkspace(workspaceId);
			const result = await deleteCardService(workspaceId, cardId, ws.repoPath);
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			return c.json({ ok: result.ok });
		},
	)
	.post(
		"/add-review-comment",
		zv(
			"json",
			z.object({
				workspaceId: z.string(),
				cardId: z.string(),
				type: z.string(),
				actor: reviewActorSchema,
				status: z.enum(["pass", "fail", "warning", "skipped"]).optional(),
				streamId: z.string().optional(),
				summary: z.string().min(1),
				issues: z.array(reviewIssueSchema).optional(),
				attachments: z.array(reviewAttachmentSchema).optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
				createdAt: z.number().optional(),
			}),
		),
		async (c) => {
			const ctx = c.var.ctx;
			const input = c.req.valid("json");
			const result = await addReviewCommentService(input);
			ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
			return c.json(result);
		},
	)
	.delete(
		"/:cardId/review-comments/:commentId",
		zv("param", z.object({ cardId: z.string(), commentId: z.string() })),
		zv("json", z.object({ workspaceId: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { cardId, commentId } = c.req.valid("param");
			const { workspaceId } = c.req.valid("json");
			const result = await deleteReviewCommentService({ workspaceId, cardId, commentId });
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			return c.json(result);
		},
	)
	.post(
		"/submit-human-feedback",
		zv(
			"json",
			z.object({
				workspaceId: z.string(),
				cardId: z.string(),
				comment: z.string().optional(),
				attachments: z.array(reviewAttachmentSchema).optional(),
				type: z.string().optional(),
				metadata: z.record(z.string(), z.unknown()).optional(),
			}),
		),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, comment, attachments, type, metadata } = c.req.valid("json");
			const result = await submitHumanFeedbackService(workspaceId, cardId, comment, attachments, type, metadata);
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			if (result.reopenCascade) {
				const scheduler = ctx.getScheduler(workspaceId);
				if (scheduler) {
					void scheduler.triggerParentReopenCascade(result.reopenCascade.feedbackCard, result.reopenCascade.boardCards);
				}
			}
			return c.json({ ok: result.ok });
		},
	)
	.post("/start-agent", zv("json", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, cardId } = c.req.valid("json");
		const scheduler = ctx.getScheduler(workspaceId);
		if (!scheduler) throw InternalError("Scheduler not ready");
		const card = await prepareStartAgentService(workspaceId, cardId);
		await scheduler.startTask(card);
		return c.json({ ok: true });
	})
	.post("/stop-agent", zv("json", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, cardId } = c.req.valid("json");
		ctx.getScheduler(workspaceId)?.stopTask(cardId);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true });
	})
	.post("/interrupt-task", zv("json", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const ctx = c.var.ctx;
		const { workspaceId, cardId } = c.req.valid("json");
		ctx.getScheduler(workspaceId)?.interruptForParentReopen(cardId);
		ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
		return c.json({ ok: true });
	})
	.post(
		"/set-pr-meta",
		zv(
			"json",
			z.object({
				workspaceId: z.string(),
				cardId: z.string(),
				title: z.string().optional(),
				description: z.string().optional(),
				updatedBy: z.string().optional(),
			}),
		),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, title, description, updatedBy } = c.req.valid("json");
			const result = await setPrMetaService(workspaceId, cardId, title, description, updatedBy);
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			return c.json(result);
		},
	)
	.post(
		"/set-plan",
		zv("json", z.object({ workspaceId: z.string(), cardId: z.string(), plan: z.string() })),
		async (c) => {
			const ctx = c.var.ctx;
			const { workspaceId, cardId, plan } = c.req.valid("json");
			const result = await setPlanService(workspaceId, cardId, plan);
			ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
			return c.json(result);
		},
	)
	.get("/diff", zv("query", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const { workspaceId, cardId } = c.req.valid("query");
		return c.json(await getDiffService(workspaceId, cardId));
	})
	.get("/commits", zv("query", z.object({ workspaceId: z.string(), cardId: z.string() })), async (c) => {
		const { workspaceId, cardId } = c.req.valid("query");
		return c.json(await getCommitsService(workspaceId, cardId));
	})
	.get(
		"/diff-for-commit",
		zv("query", z.object({ workspaceId: z.string(), cardId: z.string(), commitHash: z.string() })),
		async (c) => {
			const { workspaceId, cardId, commitHash } = c.req.valid("query");
			return c.json(await getDiffForCommitService(workspaceId, cardId, commitHash));
		},
	);
