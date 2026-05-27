import { spawnSync } from "node:child_process";
import { tunnelManager } from "../slack/cloudflare-tunnel.js";
import { createSlackApp } from "../slack/slack-setup.js";
import {
	checkCloudflaredInstalled,
	checkCloudflaredAuth,
	createTunnel,
	routeDns,
	openCloudflaredLogin,
	readTunnelConfig,
	writeTunnelConfig,
} from "../slack/cloudflare-setup.js";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAvailableAgents, getCursorModels, getOpencodeModels } from "../agents/agent-registry.js";
import { loadGlobalConfig, updateGlobalConfig, WORKSPACES_DIR, ATTACHMENTS_DIR } from "../config/runtime-config.js";
import {
	projectsLayoutSchema,
	type RuntimeBoardCard,
	type RuntimeGlobalConfig,
	reviewActorSchema,
	reviewAttachmentSchema,
	reviewIssueSchema,
	runtimeCardCreateRequestSchema,
	runtimeCardMoveRequestSchema,
	runtimeCardUpdateRequestSchema,
	runtimeGlobalConfigSchema,
	runtimeProjectConfigSchema,
	workflowSchema,
} from "../core/api-contract.js";
import { logger } from "../core/logger.js";
import type { BoardPoller } from "../daemon/poller.js";
import type { TaskScheduler } from "../daemon/scheduler.js";
import {
	abortMerge,
	attemptMerge,
	closePR,
	commitWorktree,
	createGithubPR,
	finalizeMerge,
	isWorktreeDirty,
	listLocalBranches,
	pushBranch,
} from "../git/merge-operations.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import { loadProjectsLayout, saveProjectsLayout } from "../state/projects-layout.js";
import {
	appendActivityLog,
	clearCardSession,
	createCard,
	deleteCard,
	listWorkspaces,
	loadBoard,
	loadProjectConfig,
	loadWorkspaceContext,
	loadWorkspaceState,
	moveCard,
	removeWorkspace,
	saveAttachment,
	updateProjectConfig,
	saveWorkspaceState,
	setAutonomousMode,
	updateCard,
} from "../state/workspace-state.js";
import { getCardBranch, getDefaultBranch, getWorktreePath, removeWorktreeAsync } from "../worktree/worktree-manager.js";
import { slackNotifier } from "../slack/slack-notifier.js";

// ─── GitHub image downloader ──────────────────────────────────────────────────
// Finds GitHub user-attachment image URLs in comment text, downloads them,
// saves as local attachments, and rewrites the URLs in place.
// ─── Background cleanup queue ─────────────────────────────────────────────────
// All worktree removals run serially in this queue so they never block the
// event loop (each step uses async I/O) and never contend on the git lock.
// Returns all card IDs in the same story group: the shared worktree owner + all its subtasks.
function getStoryGroupCardIds(
	cardId: string,
	cards: Record<string, import("../core/api-contract.js").RuntimeBoardCard>,
): string[] {
	const card = cards[cardId];
	if (!card) return [cardId];
	const ownerId = card.sharedWorktreeId ?? cardId;
	const subtaskIds = Object.values(cards)
		.filter((c) => c.sharedWorktreeId === ownerId)
		.map((c) => c.id);
	return [...new Set([ownerId, ...subtaskIds])];
}

const cleanupQueue: (() => Promise<void>)[] = [];
let cleanupRunning = false;

function enqueueCleanup(fn: () => Promise<void>): void {
	cleanupQueue.push(fn);
	if (!cleanupRunning) drainCleanupQueue();
}

async function drainCleanupQueue(): Promise<void> {
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
}

export interface RunSession {
	cardId: string | null;
	status: "running" | "stopped" | "error";
	errorMessage?: string;
	outputBuffer: string;
	kill: () => void;
	writeInput: (data: string) => void;
}

export interface AppContext {
	stateHub: RuntimeStateHub;
	getScheduler: (workspaceId: string) => TaskScheduler | undefined;
	getPoller: (workspaceId: string) => BoardPoller | undefined;
	ensureWorkspace: (workspaceId: string) => Promise<{ workspaceId: string; repoPath: string }>;
	currentWorkspaceId: string | null;
	currentRepoPath: string | null;
	startRun: (workspaceId: string, cardId: string | null, command: string, cwd: string) => void;
	stopRun: (workspaceId: string) => void;
	getRunSession: (workspaceId: string) => RunSession | null;
}

const t = initTRPC.context<AppContext>().create();
const router = t.router;
const publicProcedure = t.procedure;

function requireWorkspace(ctx: AppContext): { workspaceId: string; repoPath: string } {
	if (!ctx.currentWorkspaceId || !ctx.currentRepoPath) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "No workspace context" });
	}
	return { workspaceId: ctx.currentWorkspaceId, repoPath: ctx.currentRepoPath };
}

export const appRouter = router({
	// ─── Projects ──────────────────────────────────────────────────────────────
	projects: router({
		list: publicProcedure.query(async () => {
			return await listWorkspaces();
		}),

		checkPath: publicProcedure.input(z.object({ repoPath: z.string() })).query(async ({ input }) => {
			if (!input.repoPath.trim())
				return { valid: false, isGitRepo: false, error: null, name: null, branch: null, remote: null };
			const { statSync } = await import("node:fs");
			try {
				const stat = statSync(input.repoPath);
				if (!stat.isDirectory())
					return { valid: false, isGitRepo: false, error: "Not a directory", name: null, branch: null, remote: null };
			} catch {
				return { valid: false, isGitRepo: false, error: "Path does not exist", name: null, branch: null, remote: null };
			}
			const r = spawnSync("git", ["rev-parse", "--git-dir"], {
				cwd: input.repoPath,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const isGitRepo = r.status === 0;
			if (!isGitRepo)
				return {
					valid: false,
					isGitRepo: false,
					error: "Not a git repository",
					name: null,
					branch: null,
					remote: null,
				};
			const branchR = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
				cwd: input.repoPath,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const remoteR = spawnSync("git", ["remote", "get-url", "origin"], {
				cwd: input.repoPath,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const name = input.repoPath.split("/").filter(Boolean).at(-1) ?? null;
			const branch = branchR.status === 0 ? branchR.stdout.trim() : null;
			const rawRemote = remoteR.status === 0 ? remoteR.stdout.trim() : null;
			const remote = rawRemote
				? rawRemote
						.replace(/^https?:\/\//, "")
						.replace(/^git@([^:]+):/, "$1/")
						.replace(/\.git$/, "")
				: null;
			return { valid: true, isGitRepo: true, error: null, name, branch, remote };
		}),

		add: publicProcedure
			.input(
				z.object({
					repoPath: z.string().min(1),
					initialConfig: runtimeProjectConfigSchema.partial().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const { statSync } = await import("node:fs");
				try {
					const stat = statSync(input.repoPath);
					if (!stat.isDirectory()) throw new Error("Not a directory");
				} catch {
					throw new TRPCError({ code: "BAD_REQUEST", message: `Path does not exist: ${input.repoPath}` });
				}
				const r = spawnSync("git", ["rev-parse", "--git-dir"], {
					cwd: input.repoPath,
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
				});
				if (r.status !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a git repository" });
				const context = await loadWorkspaceContext(input.repoPath);
				if (input.initialConfig) {
					await updateProjectConfig(context.workspaceId, (current) =>
						runtimeProjectConfigSchema.parse({ ...current, ...input.initialConfig }),
					);
				}
				await ctx.ensureWorkspace(context.workspaceId);
				return context;
			}),

		remove: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(async ({ ctx, input }) => {
			const { workspaceId } = input;

			// Get workspace info before removing (repoPath needed for worktree cleanup)
			const allWorkspaces = await listWorkspaces();
			const ws = allWorkspaces.find((w) => w.workspaceId === workspaceId);

			// Stop all running agents and the run session
			const scheduler = ctx.getScheduler(workspaceId);
			if (scheduler) {
				scheduler.prepareShutdown();
				scheduler.stopAll();
			}
			ctx.stopRun(workspaceId);

			// Load board cards before removing the workspace (needed for cleanup)
			let boardCards: Record<string, RuntimeBoardCard> = {};
			if (ws) {
				try {
					const board = await loadBoard(workspaceId);
					boardCards = board.cards;
				} catch {
					// ignore — board may not exist yet
				}
			}

			// Remove from workspace index
			await removeWorkspace(workspaceId);

			// Queue async cleanup of worktrees and workspace data files
			if (ws) {
				const repoPath = ws.repoPath;
				const cards = boardCards;
				enqueueCleanup(async () => {
					const { rm } = await import("node:fs/promises");
					const { join } = await import("node:path");

					// Clean up each card's worktree (owner cards only — shared-worktree subtasks share the owner's)
					for (const [cardId, card] of Object.entries(cards)) {
						if (!card.sharedWorktreeId) {
							await removeWorktreeAsync(cardId, repoPath, card.branchName).catch((err) => {
								logger.warn(`[cleanup:project:${workspaceId}] worktree ${cardId} failed: ${String(err)}`);
							});
						}
					}

					// Remove workspace data directory (board.json, project-config.json, meta.json, buffers/)
					await rm(join(WORKSPACES_DIR, workspaceId), { recursive: true, force: true }).catch((err) => {
						logger.warn(`[cleanup:project:${workspaceId}] workspace dir failed: ${String(err)}`);
					});

					// Remove per-card attachment directories
					for (const cardId of Object.keys(cards)) {
						await rm(join(ATTACHMENTS_DIR, cardId), { recursive: true, force: true }).catch(() => {});
					}

					logger.info(`[cleanup:project:${workspaceId}] done`);
				});
			}

			return { ok: true };
		}),

		getLayout: publicProcedure.query(() => loadProjectsLayout()),

		saveLayout: publicProcedure.input(projectsLayoutSchema).mutation(({ input }) => {
			saveProjectsLayout(input);
			return { ok: true };
		}),
	}),

	// ─── Workspace ─────────────────────────────────────────────────────────────
	workspace: router({
		state: publicProcedure.input(z.object({ workspaceId: z.string() }).optional()).query(async ({ ctx, input }) => {
			if (input?.workspaceId) {
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === input.workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
				return await loadWorkspaceState(ws.workspaceId, ws.repoPath);
			}
			const { workspaceId, repoPath } = requireWorkspace(ctx);
			return await loadWorkspaceState(workspaceId, repoPath);
		}),

		save: publicProcedure
			.input(z.object({ workspaceId: z.string(), board: z.any(), revision: z.number() }))
			.mutation(async ({ input }) => {
				return await saveWorkspaceState(input.workspaceId, { board: input.board, revision: input.revision });
			}),

		setAutonomousMode: publicProcedure
			.input(z.object({ workspaceId: z.string(), enabled: z.boolean() }))
			.mutation(async ({ ctx, input }) => {
				await setAutonomousMode(input.workspaceId, input.enabled);
				const poller = ctx.getPoller(input.workspaceId);
				if (input.enabled) {
					poller?.start();
				} else {
					poller?.stop();
				}
				ctx.stateHub.broadcastAutonomousModeChange(input.workspaceId, input.enabled);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),

		listRootFiles: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ ctx, input }) => {
			const ws = await ctx.ensureWorkspace(input.workspaceId);
			const ignored = spawnSync(
				"git",
				["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"],
				{ cwd: ws.repoPath, encoding: "utf-8" },
			);
			const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
				cwd: ws.repoPath,
				encoding: "utf-8",
			});
			const all = [...(ignored.stdout ?? "").split("\n"), ...(untracked.stdout ?? "").split("\n")]
				.map((f) => f.trim().replace(/\/$/, ""))
				.filter((f) => f && !f.includes("/"));
			return { files: [...new Set(all)].sort() };
		}),
	}),

	// ─── Per-project config ────────────────────────────────────────────────────
	projectConfig: router({
		get: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ input }) => {
			return await loadProjectConfig(input.workspaceId);
		}),

		save: publicProcedure
			.input(z.object({ workspaceId: z.string(), config: runtimeProjectConfigSchema }))
			.mutation(async ({ ctx, input }) => {
				// Full-replace, but acquired through the lock so it serializes against
				// any concurrent partial setters (workflows, gitInstructions, etc.).
				await updateProjectConfig(input.workspaceId, () => input.config);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),

		setGitInstructions: publicProcedure
			.input(z.object({ workspaceId: z.string(), instructions: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const trimmed = input.instructions.trim();
				await updateProjectConfig(input.workspaceId, (c) => ({
					...c,
					gitInstructions: trimmed || undefined,
				}));
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true, cleared: !trimmed };
			}),

		setSystemPrompt: publicProcedure
			.input(z.object({ workspaceId: z.string(), prompt: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const trimmed = input.prompt.trim();
				await updateProjectConfig(input.workspaceId, (c) => ({
					...c,
					systemPrompt: trimmed || undefined,
				}));
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true, cleared: !trimmed };
			}),
	}),

	// ─── Workflows ────────────────────────────────────────────────────────────
	workflows: router({
		list: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ input }) => {
			const config = await loadProjectConfig(input.workspaceId);
			return config.workflows;
		}),

		upsert: publicProcedure
			.input(z.object({ workspaceId: z.string(), workflow: workflowSchema }))
			.mutation(async ({ ctx, input }) => {
				await updateProjectConfig(input.workspaceId, (config) => {
					const idx = config.workflows.findIndex((w) => w.id === input.workflow.id);
					const workflows = [...config.workflows];
					if (idx >= 0) {
						workflows[idx] = input.workflow;
					} else {
						workflows.push(input.workflow);
					}
					return { ...config, workflows };
				});
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return input.workflow;
			}),

		delete: publicProcedure
			.input(z.object({ workspaceId: z.string(), workflowId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				await updateProjectConfig(input.workspaceId, (config) => ({
					...config,
					workflows: config.workflows.filter((w) => w.id !== input.workflowId),
				}));
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),
	}),

	// ─── Cards ─────────────────────────────────────────────────────────────────
	cards: router({
		create: publicProcedure
			.input(runtimeCardCreateRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, baseRef: requestedBase, ...cardData } = input;
				try {
					const workspaces = await listWorkspaces();
					const ws = workspaces.find((w) => w.workspaceId === workspaceId);
					if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
					const config = await loadProjectConfig(workspaceId);
					const baseRef = requestedBase || config.defaultBaseBranch || getDefaultBranch(ws.repoPath);
					const card = await createCard(workspaceId, cardData, baseRef);
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
					return card;
				} catch (err) {
					logger.error(
						`[cards.create] Error creating card: ${String(err)}\nInput: ${JSON.stringify(input)}\nStack: ${err instanceof Error ? err.stack : ""}`,
					);
					throw err;
				}
			}),

		listBranches: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ input }) => {
			const workspaces = await listWorkspaces();
			const ws = workspaces.find((w) => w.workspaceId === input.workspaceId);
			if (!ws) return { branches: [], defaultBranch: "main" };
			const branches = listLocalBranches(ws.repoPath);
			const config = await loadProjectConfig(input.workspaceId);
			const defaultBranch = config.defaultBaseBranch ?? getDefaultBranch(ws.repoPath);
			return { branches, defaultBranch };
		}),

		commitAndMerge: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string(), commitMessage: z.string().optional() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
				if (card.columnId !== "ready_for_review") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Card is not in Ready for Review" });
				}

				const effectiveWorktreeId = card.sharedWorktreeId ?? cardId;
				const worktreePath = getWorktreePath(effectiveWorktreeId);
				const taskBranch = getCardBranch(card);

				const mergeConfig = await loadProjectConfig(workspaceId);

				const dirty = await isWorktreeDirty(worktreePath);
				if (dirty) {
					if (!input.commitMessage) {
						return { status: "needs_commit" as const };
					}
					await commitWorktree(worktreePath, input.commitMessage);
				}

				let mergeResult: ReturnType<typeof attemptMerge>;
				try {
					mergeResult = attemptMerge(ws.repoPath, effectiveWorktreeId, taskBranch);
				} catch (err) {
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
				}

				const mergeGithubToken = mergeConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;

				// Collect all cards in the same story group (this card + siblings + story/owner).
				const mergeBoard = await loadBoard(workspaceId);
				const storyGroupIds = getStoryGroupCardIds(cardId, mergeBoard.cards);
				const sharedPrUrl = storyGroupIds.map((id) => mergeBoard.cards[id]?.pr?.url).find(Boolean);

				const closeSharedPR = () => {
					if (sharedPrUrl && mergeGithubToken) {
						closePR(sharedPrUrl, mergeGithubToken).catch((err) => {
							logger.warn(`[merge] Failed to close PR ${sharedPrUrl}: ${String(err)}`);
						});
					}
				};

				const markAllDone = async (logSuffix: string) => {
					for (const relId of storyGroupIds) {
						const relCard = mergeBoard.cards[relId];
						if (relCard && relCard.columnId !== "done") {
							await moveCard(workspaceId, relId, "done");
							await appendActivityLog(workspaceId, relId, logSuffix);
						}
					}
				};

				if (mergeResult.ok) {
					closeSharedPR();
					await markAllDone(`Merged into ${card.baseRef} → Done`);
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
					return { status: "merged" as const };
				}

				if (mergeResult.dirtyBase) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Cannot merge: the base branch has uncommitted or staged changes. Commit or stash them first.",
					});
				}

				// Conflicts in the main repo — spawn conflict resolution agent
				await appendActivityLog(
					workspaceId,
					cardId,
					`Merge conflicts in: ${mergeResult.conflictedFiles.join(", ")} — resolving...`,
				);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);

				const scheduler = ctx.getScheduler(workspaceId);
				if (!scheduler) {
					abortMerge(ws.repoPath);
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scheduler not ready" });
				}

				await scheduler.startConflictResolution(card, ws.repoPath, mergeResult.conflictedFiles, async (success) => {
					if (success) {
						finalizeMerge(ws.repoPath, taskBranch);
						closeSharedPR();
						await markAllDone(`Conflicts resolved → merged into ${card.baseRef} → Done`);
					} else {
						abortMerge(ws.repoPath);
						await moveCard(workspaceId, cardId, "blocked");
						await appendActivityLog(workspaceId, cardId, "Could not resolve merge conflicts → Blocked");
						await clearCardSession(workspaceId, cardId);
					}
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				});

				return { status: "resolving_conflicts" as const };
			}),

		commitAndPR: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string(), commitMessage: z.string().optional() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
				if (card.columnId !== "ready_for_review") {
					throw new TRPCError({ code: "BAD_REQUEST", message: "Card is not in Ready for Review" });
				}

				const prProjectConfig = await loadProjectConfig(workspaceId);
				const prGithubToken = prProjectConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;
				if (!prGithubToken) {
					logger.warn(`[commitAndPR] GITHUB_TOKEN not set for workspace ${workspaceId} — PR creation skipped`);
					return { status: "no_token" as const };
				}

				const prWorktreePath = getWorktreePath(card.sharedWorktreeId ?? cardId);
				const taskBranch = getCardBranch(card);

				const dirty = await isWorktreeDirty(prWorktreePath);
				if (dirty) {
					if (!input.commitMessage) {
						return { status: "needs_commit" as const };
					}
					await commitWorktree(prWorktreePath, input.commitMessage);
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
						throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Push failed: ${err}` });
					}

					// Use the story/owner card's PR metadata when available for a unified PR title.
					const ownerCard = prBoard.cards[card.sharedWorktreeId ?? cardId];
					const devSummary =
						[...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.summary ?? card.description;
					const prTitle =
						ownerCard?.pr?.title ??
						card.pr?.title ??
						(ownerCard ?? card).description?.split("\n")[0]?.slice(0, 72) ??
						cardId;
					const prDescription = ownerCard?.pr?.description ?? card.pr?.description ?? devSummary;

					try {
						prUrl = await createGithubPR(prWorktreePath, prTitle, prDescription, card.baseRef, prGithubToken);
					} catch (err) {
						spawnSync("git", ["push", "origin", "--delete", taskBranch], { cwd: prWorktreePath, stdio: "ignore" });
						throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PR creation failed: ${err}` });
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
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return { status: "pr_created" as const, prUrl };
			}),

		update: publicProcedure
			.input(runtimeCardUpdateRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId, revision, ...update } = input;
				try {
					const card = await updateCard(workspaceId, cardId, update);
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
					return card;
				} catch (err) {
					logger.error(
						`[cards.update] Error updating card ${cardId}: ${String(err)}\nUpdate: ${JSON.stringify(update)}\nStack: ${err instanceof Error ? err.stack : ""}`,
					);
					throw err;
				}
			}),

		move: publicProcedure
			.input(runtimeCardMoveRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId, targetColumnId, targetIndex } = input;
				const board = await moveCard(workspaceId, cardId, targetColumnId, targetIndex);
				// Clear session so the poller can pick up cards moved back to work columns
				if (targetColumnId === "reopened" || targetColumnId === "todo") {
					await clearCardSession(workspaceId, cardId);
				}
				if (targetColumnId === "reopened") {
					await updateCard(workspaceId, cardId, { autoFixAttempts: 0 });
					const moveScheduler = ctx.getScheduler(workspaceId);
					if (moveScheduler) {
						const movedBoard = await loadBoard(workspaceId);
						const movedCard = movedBoard.cards[cardId];
						if (movedCard) void moveScheduler.triggerParentReopenCascade(movedCard, movedBoard.cards);
					}
				}
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return board;
			}),

		delete: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId } = input;
				ctx.getScheduler(workspaceId)?.stopTask(cardId);
				const ws = await ctx.ensureWorkspace(workspaceId);

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];

				await Promise.all([deleteCard(workspaceId, cardId), clearCardSession(workspaceId, cardId)]);
				if (card && card.columnId !== "done") {
					void slackNotifier.notifyCardDeleted(card);
				}
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);

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
					if (!card?.sharedWorktreeId) {
						const cleanupBoard = await loadBoard(workspaceId).catch(() => null);
						const hasDependents = cleanupBoard
							? Object.values(cleanupBoard.cards).some((c) => c.dependsOn.includes(cardId))
							: false;
						if (!hasDependents) {
							await removeWorktreeAsync(cardId, ws.repoPath, card?.branchName);
						}
					}
				});

				return { ok: true };
			}),

		addReviewComment: publicProcedure
			.input(
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
			)
			.mutation(async ({ ctx, input }) => {
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

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

				const comment = {
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
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true, comment };
			}),

		submitHumanFeedback: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					cardId: z.string(),
					comment: z.string().optional(),
					attachments: z.array(reviewAttachmentSchema).optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const trimmed = input.comment?.trim();
				const hasContent = trimmed || (input.attachments?.length ?? 0) > 0;
				const updatedComments = hasContent
					? [
							...(card.reviewComments ?? []),
							{
								type: "human" as const,
								actor: { type: "human" as const, id: "human" },
								createdAt: Date.now(),
								summary: trimmed ?? "Feedback with attachments",
								attachments: input.attachments?.length ? input.attachments : undefined,
							},
						]
					: (card.reviewComments ?? []);
				await updateCard(input.workspaceId, input.cardId, { reviewComments: updatedComments, autoFixAttempts: 0 });
				await moveCard(input.workspaceId, input.cardId, "reopened");
				await clearCardSession(input.workspaceId, input.cardId);
				await appendActivityLog(input.workspaceId, input.cardId, "Human feedback submitted → moved to Reopened");
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				const feedbackScheduler = ctx.getScheduler(input.workspaceId);
				if (feedbackScheduler) {
					const feedbackBoard = await loadBoard(input.workspaceId);
					const feedbackCard = feedbackBoard.cards[input.cardId];
					if (feedbackCard) void feedbackScheduler.triggerParentReopenCascade(feedbackCard, feedbackBoard.cards);
				}
				return { ok: true };
			}),

		startAgent: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === input.workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
				const state = await loadWorkspaceState(input.workspaceId, ws.repoPath);
				const card = state.board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
				const scheduler = ctx.getScheduler(input.workspaceId);
				if (!scheduler) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scheduler not ready" });
				await updateCard(input.workspaceId, input.cardId, { autoFixAttempts: 0 });
				await scheduler.startTask(card);
				return { ok: true };
			}),

		stopAgent: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.stopTask(input.cardId);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),

		interruptTask: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.interruptForParentReopen(input.cardId);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),

		setPrMeta: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					cardId: z.string(),
					title: z.string().optional(),
					description: z.string().optional(),
					updatedBy: z.string().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				// Merge title/description into card.pr — preserves url (daemon owns it).
				const nextPr = {
					...card.pr,
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.description !== undefined ? { description: input.description } : {}),
					updatedAt: Date.now(),
					...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
				};
				await updateCard(input.workspaceId, input.cardId, { pr: nextPr });
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true, pr: nextPr };
			}),

		getDiff: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.query(async ({ input }) => {
				const { workspaceId, cardId } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const worktreePath = getWorktreePath(card.sharedWorktreeId ?? cardId);
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
			}),

		getCommits: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.query(async ({ input }) => {
				const { workspaceId, cardId } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const worktreePath = getWorktreePath(card.sharedWorktreeId ?? cardId);
				const { existsSync } = await import("node:fs");
				if (!existsSync(worktreePath)) return { commits: [] };

				const result = spawnSync(
					"git",
					["log", "--pretty=format:%H%x00%h%x00%s%x00%an%x00%ai", `${card.baseRef}..HEAD`],
					{ cwd: worktreePath, encoding: "utf-8" },
				);

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
			}),

		getDiffForCommit: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string(), commitHash: z.string() }))
			.query(async ({ input }) => {
				const { workspaceId, cardId, commitHash } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				if (!/^[0-9a-f]{4,64}$/i.test(commitHash)) return { diff: null, error: "Invalid commit hash" };

				const worktreePath = getWorktreePath(card.sharedWorktreeId ?? cardId);
				const { existsSync } = await import("node:fs");
				if (!existsSync(worktreePath)) return { diff: null, error: "No worktree" };

				const result = spawnSync(
					"git",
					["show", commitHash, "--format=", "--patch", "--no-color", "-U3"],
					{ cwd: worktreePath, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 },
				);

				if (result.status !== 0) {
					return { diff: null, error: result.stderr?.trim() ?? "Failed to get commit diff" };
				}

				return { diff: result.stdout.replace(/^\n+/, ""), error: null };
			}),
	}),

	// ─── Terminal ──────────────────────────────────────────────────────────────
	terminal: router({
		buffer: publicProcedure.input(z.object({ workspaceId: z.string(), taskId: z.string() })).query(({ ctx, input }) => {
			const buf = ctx.getScheduler(input.workspaceId)?.getOutputBuffer(input.taskId) ?? "";
			return { data: buf };
		}),

		resize: publicProcedure
			.input(z.object({ workspaceId: z.string(), taskId: z.string(), cols: z.number(), rows: z.number() }))
			.mutation(({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.resizeTerminal(input.taskId, input.cols, input.rows);
				return { ok: true };
			}),

		input: publicProcedure
			.input(z.object({ workspaceId: z.string(), taskId: z.string(), data: z.string() }))
			.mutation(({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.writeToTerminal(input.taskId, input.data);
				return { ok: true };
			}),
	}),

	// ─── Filesystem browser ────────────────────────────────────────────────────
	fs: router({
		openPath: publicProcedure.input(z.object({ path: z.string() })).mutation(({ input }) => {
			const cmd = process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
			spawnSync(cmd, [input.path], { stdio: "ignore" });
			return { ok: true };
		}),

		listTerminals: publicProcedure.query(async () => {
			const { listTerminalApps } = await import("../core/terminal-apps.js");
			return listTerminalApps();
		}),

		openTerminal: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ input }) => {
			const { openTerminalAt } = await import("../core/terminal-apps.js");
			const config = await loadGlobalConfig();
			openTerminalAt(input.path, config.terminalApp);
			return { ok: true };
		}),

		listDir: publicProcedure.input(z.object({ path: z.string() })).query(async ({ input }) => {
			const { readdirSync } = await import("node:fs");
			const { join: pathJoin, dirname, resolve } = await import("node:path");
			const { homedir } = await import("node:os");
			const target = input.path || homedir();
			const parent = dirname(resolve(target));
			try {
				const entries = readdirSync(target, { withFileTypes: true });
				const dirs = entries
					.filter((e) => e.isDirectory() && !e.name.startsWith("."))
					.map((e) => ({ name: e.name, path: pathJoin(target, e.name) }))
					.sort((a, b) => a.name.localeCompare(b.name));
				return { current: target, parent: parent !== target ? parent : null, dirs };
			} catch {
				return { current: target, parent: null, dirs: [] };
			}
		}),
	}),

	// ─── Global config ─────────────────────────────────────────────────────────
	config: router({
		get: publicProcedure.query(async () => {
			return await loadGlobalConfig();
		}),

		save: publicProcedure.input(runtimeGlobalConfigSchema.partial()).mutation(async ({ input }) => {
			return await updateGlobalConfig(input as Partial<RuntimeGlobalConfig>);
		}),
	}),

	// ─── Agents ────────────────────────────────────────────────────────────────
	agents: router({
		available: publicProcedure.query(() => {
			return getAvailableAgents();
		}),
		opencodeModels: publicProcedure.query(() => {
			return getOpencodeModels();
		}),
		cursorModels: publicProcedure.query(() => {
			return getCursorModels();
		}),
	}),

	// ─── Assistant terminal session ───────────────────────────────────────
	agent: router({
		startSession: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(async ({ ctx, input }) => {
			const scheduler = ctx.getScheduler(input.workspaceId);
			if (!scheduler) {
				await ctx.ensureWorkspace(input.workspaceId);
				const retried = ctx.getScheduler(input.workspaceId);
				if (!retried) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
				return { taskId: await retried.startHomeAgent() };
			}
			return { taskId: await scheduler.startHomeAgent() };
		}),

		stopSession: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(({ ctx, input }) => {
			ctx.getScheduler(input.workspaceId)?.stopHomeAgent();
		}),

		sessionStatus: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ ctx, input }) => {
			const scheduler = ctx.getScheduler(input.workspaceId);
			if (!scheduler) return { running: false, taskId: null };
			return {
				running: scheduler.isHomeAgentRunning(),
				taskId: scheduler.homeAgentTaskId,
			};
		}),
	}),

	// ─── Run session (per-project) ────────────────────────────────────────────
	run: router({
		status: publicProcedure.input(z.object({ workspaceId: z.string() })).query(({ ctx, input }) => {
			const session = ctx.getRunSession(input.workspaceId);
			if (!session) return { cardId: null, status: "stopped" as const, errorMessage: undefined };
			return { cardId: session.cardId, status: session.status, errorMessage: session.errorMessage };
		}),

		start: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const ws = await ctx.ensureWorkspace(input.workspaceId);
				const projectConfig = await loadProjectConfig(input.workspaceId);
				const command = projectConfig.startCommand?.trim();
				if (!command) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "No start command configured. Add one in Settings → Environment.",
					});
				}
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });
				const cwd = card.worktreePath ?? ws.repoPath;
				ctx.startRun(input.workspaceId, input.cardId, command, cwd);
				return { ok: true };
			}),

		startBase: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(async ({ ctx, input }) => {
			const ws = await ctx.ensureWorkspace(input.workspaceId);
			const projectConfig = await loadProjectConfig(input.workspaceId);
			const command = projectConfig.startCommand?.trim();
			if (!command) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "No start command configured. Add one in Settings → Environment.",
				});
			}
			ctx.startRun(input.workspaceId, null, command, ws.repoPath);
			return { ok: true };
		}),

		stop: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(({ ctx, input }) => {
			ctx.stopRun(input.workspaceId);
			return { ok: true };
		}),
	}),

	// ─── Jira (per-project) ───────────────────────────────────────────────────
	slack: router({
		checkCloudflared: publicProcedure.query(async () => {
			const [install, authed] = await Promise.all([checkCloudflaredInstalled(), checkCloudflaredAuth()]);
			return { ...install, authed };
		}),
		cloudflaredLogin: publicProcedure
			.input(z.object({ force: z.boolean().default(false) }))
			.mutation(({ input }) => openCloudflaredLogin(input.force)),
		createTunnel: publicProcedure.input(z.object({ domain: z.string() })).mutation(async ({ input }) => {
			const config = await loadGlobalConfig();
			const name = config.tunnelName ?? "overemployed";
			const { tunnelId } = await createTunnel(name);
			await writeTunnelConfig(tunnelId, name, input.domain);
			await routeDns(name, input.domain);
			await updateGlobalConfig({ tunnelId, tunnelDomain: input.domain });
			return { tunnelId };
		}),
		tunnelConfig: publicProcedure.query(async () => {
			const [config, fileConfig] = await Promise.all([loadGlobalConfig(), readTunnelConfig()]);
			return {
				tunnelId: config.tunnelId ?? fileConfig?.tunnelId,
				domain: config.tunnelDomain ?? fileConfig?.domain,
				tunnelName: config.tunnelName ?? "overemployed",
			};
		}),
		tunnelStatus: publicProcedure.query(() => tunnelManager.getState()),
		startTunnel: publicProcedure.mutation(() => {
			tunnelManager.start();
			return tunnelManager.getState();
		}),
		stopTunnel: publicProcedure.mutation(() => {
			tunnelManager.stop();
			return tunnelManager.getState();
		}),
		resetTunnel: publicProcedure.mutation(async () => {
			tunnelManager.stop();
			await updateGlobalConfig({ tunnelId: undefined, tunnelDomain: undefined, autoStartTunnel: false });
			// Remove the cloudflared config file so the wizard starts clean
			const { unlink } = await import("node:fs/promises");
			const { homedir } = await import("node:os");
			const { join } = await import("node:path");
			try {
				await unlink(join(homedir(), ".cloudflared", "config.yml"));
			} catch {
				/* already gone */
			}
		}),
		resetApp: publicProcedure.mutation(async () => {
			await updateGlobalConfig({
				slackBotToken: undefined,
				slackSigningSecret: undefined,
				slackAppConfigToken: undefined,
				slackClientId: undefined,
				slackClientSecret: undefined,
				slackAppId: undefined,
				slackOauthAuthorizeUrl: undefined,
				slackPublicUrl: undefined,
				slackBotName: undefined,
				slackInstallerUserId: undefined,
			});
		}),
		updateSigningSecret: publicProcedure
			.input(z.object({ signingSecret: z.string().min(1) }))
			.mutation(async ({ input }) => {
				await updateGlobalConfig({ slackSigningSecret: input.signingSecret });
			}),
		importCredentials: publicProcedure
			.input(
				z.object({
					slackAppId: z.string(),
					slackClientId: z.string(),
					slackClientSecret: z.string(),
					slackSigningSecret: z.string(),
					slackOauthAuthorizeUrl: z.string(),
					slackPublicUrl: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				await updateGlobalConfig(input);
			}),
		createApp: publicProcedure
			.input(
				z.object({ appConfigToken: z.string(), publicUrl: z.string(), botName: z.string().default("Overemployed") }),
			)
			.mutation(async ({ input }) => {
				const existing = await loadGlobalConfig();
				const app = await createSlackApp(input.appConfigToken, input.publicUrl, existing.slackAppId, input.botName);
				const clientId = app.clientId || existing.slackClientId || "";
				const scopes =
					"channels:manage,channels:join,channels:read,channels:history,chat:write,chat:write.public,groups:write,groups:read,groups:history,commands";
				const oauthAuthorizeUrl =
					app.oauthAuthorizeUrl ||
					existing.slackOauthAuthorizeUrl ||
					(clientId ? `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}` : "");
				await updateGlobalConfig({
					slackAppConfigToken: input.appConfigToken,
					slackAppId: app.appId,
					slackPublicUrl: input.publicUrl,
					slackBotName: input.botName,
					...(app.clientId && { slackClientId: app.clientId }),
					...(app.clientSecret && { slackClientSecret: app.clientSecret }),
					...(app.signingSecret && { slackSigningSecret: app.signingSecret }),
					slackOauthAuthorizeUrl: oauthAuthorizeUrl,
				});
				return { ...app, oauthAuthorizeUrl };
			}),
	}),
	jira: router({
		fetchTickets: publicProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ input }) => {
			const projectConfig = await loadProjectConfig(input.workspaceId);
			if (!projectConfig.jira)
				throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Jira not configured for this project" });
			const { createJiraClient } = await import("../jira/jira-client.js");
			return await createJiraClient(projectConfig.jira).fetchProjectTickets();
		}),

		importTickets: publicProcedure
			.input(z.object({ workspaceId: z.string(), ticketKeys: z.array(z.string()) }))
			.mutation(async ({ ctx, input }) => {
				const projectConfig = await loadProjectConfig(input.workspaceId);
				if (!projectConfig.jira)
					throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Jira not configured for this project" });
				const { createJiraClient } = await import("../jira/jira-client.js");
				const client = createJiraClient(projectConfig.jira);
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === input.workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const created = [];
				for (const key of input.ticketKeys) {
					const ticket = await client.fetchTicket(key);
					const description = [
						ticket.description,
						ticket.comments.length > 0
							? `\n\n## Comments\n${ticket.comments.map((c) => `**${c.author}:** ${c.body}`).join("\n\n")}`
							: "",
					].join("");
					const baseRef = getDefaultBranch(ws.repoPath);
					const card = await createCard(
						input.workspaceId,
						{
							description: `[${ticket.key}] ${ticket.summary}\n\n${description}`.trim(),
							jiraKey: ticket.key,
							jiraUrl: ticket.url,
						},
						baseRef,
					);
					created.push(card);
				}
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { created };
			}),
	}),
});

export type AppRouter = typeof appRouter;
