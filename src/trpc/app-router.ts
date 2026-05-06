import { logger } from "../core/logger.js";
import { spawnSync } from "node:child_process";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAvailableAgents } from "../agents/agent-registry.js";
import { loadGlobalConfig, saveGlobalConfig, updateGlobalConfig } from "../config/runtime-config.js";
import { abortMerge, attemptMerge, commitIfDirty, createGithubPR, finalizeMerge, listLocalBranches, pushBranch } from "../git/merge-operations.js";
import {
	type RuntimeGlobalConfig,
	type RuntimeProjectConfig,
	runtimeCardCreateRequestSchema,
	runtimeCardMoveRequestSchema,
	runtimeCardUpdateRequestSchema,
	runtimeGlobalConfigSchema,
	runtimeJiraImportRequestSchema,
	runtimeProjectConfigSchema,
	workflowSchema,
} from "../core/api-contract.js";
import type { BoardPoller } from "../daemon/poller.js";
import type { TaskScheduler } from "../daemon/scheduler.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	appendActivityLog,
	createCard,
	deleteCard,
	listWorkspaces,
	loadBoard,
	loadProjectConfig,
	loadWorkspaceContext,
	loadWorkspaceState,
	moveCard,
	removeSession,
	removeWorkspace,
	saveProjectConfig,
	saveWorkspaceState,
	setAutonomousMode,
	updateCard,
	updateSession,
} from "../state/workspace-state.js";
import { removeWorktreeAsync } from "../worktree/worktree-manager.js";
import { getDefaultBranch, getWorktreeBranch, getWorktreePath } from "../worktree/worktree-manager.js";

// ─── Background cleanup queue ─────────────────────────────────────────────────
// All worktree removals run serially in this queue so they never block the
// event loop (each step uses async I/O) and never contend on the git lock.
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

export interface AppContext {
	stateHub: RuntimeStateHub;
	getScheduler: (workspaceId: string) => TaskScheduler | undefined;
	getPoller: (workspaceId: string) => BoardPoller | undefined;
	ensureWorkspace: (workspaceId: string) => Promise<{ workspaceId: string; repoPath: string }>;
	currentWorkspaceId: string | null;
	currentRepoPath: string | null;
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
			if (!input.repoPath.trim()) return { valid: false, isGitRepo: false, error: null };
			const { statSync } = await import("node:fs");
			try {
				const stat = statSync(input.repoPath);
				if (!stat.isDirectory()) return { valid: false, isGitRepo: false, error: "Not a directory" };
			} catch {
				return { valid: false, isGitRepo: false, error: "Path does not exist" };
			}
			const r = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: input.repoPath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
			const isGitRepo = r.status === 0;
			return { valid: isGitRepo, isGitRepo, error: isGitRepo ? null : "Not a git repository" };
		}),

		add: publicProcedure
			.input(z.object({
				repoPath: z.string().min(1),
				initialConfig: runtimeProjectConfigSchema.partial().optional(),
			}))
			.mutation(async ({ ctx, input }) => {
				const { statSync } = await import("node:fs");
				try {
					const stat = statSync(input.repoPath);
					if (!stat.isDirectory()) throw new Error("Not a directory");
				} catch {
					throw new TRPCError({ code: "BAD_REQUEST", message: `Path does not exist: ${input.repoPath}` });
				}
				const r = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: input.repoPath, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
				if (r.status !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Not a git repository" });
				const context = await loadWorkspaceContext(input.repoPath);
				await ctx.ensureWorkspace(context.workspaceId);
				if (input.initialConfig) {
					const current = await loadProjectConfig(context.workspaceId);
					await saveProjectConfig(context.workspaceId, runtimeProjectConfigSchema.parse({ ...current, ...input.initialConfig }));
				}
				return context;
			}),

		remove: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(async ({ input }) => {
			await removeWorkspace(input.workspaceId);
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

		listRootFiles: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ ctx, input }) => {
				const ws = await ctx.ensureWorkspace(input.workspaceId);
				const ignored = spawnSync(
					"git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"],
					{ cwd: ws.repoPath, encoding: "utf-8" },
				);
				const untracked = spawnSync(
					"git", ["ls-files", "--others", "--exclude-standard"],
					{ cwd: ws.repoPath, encoding: "utf-8" },
				);
				const all = [
					...(ignored.stdout ?? "").split("\n"),
					...(untracked.stdout ?? "").split("\n"),
				]
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
				await saveProjectConfig(input.workspaceId, input.config);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true };
			}),
	}),

	// ─── Workflows ────────────────────────────────────────────────────────────
	workflows: router({
		list: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const config = await loadProjectConfig(input.workspaceId);
				return config.workflows;
			}),

		upsert: publicProcedure
			.input(z.object({ workspaceId: z.string(), workflow: workflowSchema }))
			.mutation(async ({ ctx, input }) => {
				const config = await loadProjectConfig(input.workspaceId);
				const idx = config.workflows.findIndex((w) => w.id === input.workflow.id);
				if (idx >= 0) {
					config.workflows[idx] = input.workflow;
				} else {
					config.workflows.push(input.workflow);
				}
				await saveProjectConfig(input.workspaceId, config);
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return input.workflow;
			}),

		delete: publicProcedure
			.input(z.object({ workspaceId: z.string(), workflowId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const config = await loadProjectConfig(input.workspaceId);
				config.workflows = config.workflows.filter((w) => w.id !== input.workflowId);
				await saveProjectConfig(input.workspaceId, config);
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
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
				const baseRef = requestedBase || getDefaultBranch(ws.repoPath);
				const card = await createCard(workspaceId, cardData, baseRef);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return card;
			}),

		listBranches: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(async ({ input }) => {
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === input.workspaceId);
				if (!ws) return { branches: [], defaultBranch: "main" };
				const branches = listLocalBranches(ws.repoPath);
				const defaultBranch = getDefaultBranch(ws.repoPath);
				return { branches, defaultBranch };
			}),

		commitAndMerge: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
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

				const worktreePath = getWorktreePath(cardId);
				const taskBranch = getWorktreeBranch(cardId);

				await commitIfDirty(worktreePath, card.title);

				let mergeResult;
				try {
					mergeResult = attemptMerge(ws.repoPath, cardId, taskBranch);
				} catch (err) {
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
				}

				if (mergeResult.ok) {
					if (card.githubPrUrl) {
						spawnSync("gh", ["pr", "close", card.githubPrUrl, "--comment", "Merged locally"], { stdio: "ignore" });
					}
					await moveCard(workspaceId, cardId, "done");
					await appendActivityLog(workspaceId, cardId, `Merged into ${card.baseRef} → Done`);
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
					return { status: "merged" as const };
				}

				// Conflicts in the main repo — spawn conflict resolution agent
				await appendActivityLog(workspaceId, cardId, `Merge conflicts in: ${mergeResult.conflictedFiles.join(", ")} — resolving...`);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);

				const scheduler = ctx.getScheduler(workspaceId);
				if (!scheduler) {
					abortMerge(ws.repoPath);
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Scheduler not ready" });
				}

				await scheduler.startConflictResolution(card, ws.repoPath, mergeResult.conflictedFiles, async (success) => {
					if (success) {
						finalizeMerge(ws.repoPath, taskBranch);
						if (card.githubPrUrl) {
							spawnSync("gh", ["pr", "close", card.githubPrUrl, "--comment", "Merged locally"], { stdio: "ignore" });
						}
						await moveCard(workspaceId, cardId, "done");
						await appendActivityLog(workspaceId, cardId, `Conflicts resolved → merged into ${card.baseRef} → Done`);
					} else {
						abortMerge(ws.repoPath);
						await moveCard(workspaceId, cardId, "blocked");
						await appendActivityLog(workspaceId, cardId, "Could not resolve merge conflicts → Blocked");
						await updateSession(workspaceId, cardId, { state: "idle" });
					}
					ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				});

				return { status: "resolving_conflicts" as const };
			}),

		commitAndPR: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
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

				const worktreePath = getWorktreePath(cardId);
				const taskBranch = getWorktreeBranch(cardId);

				await commitIfDirty(worktreePath, card.title);

				try {
					pushBranch(worktreePath, taskBranch);
				} catch (err) {
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Push failed: ${err}` });
				}

				const devSummary = [...(card.reviewComments ?? [])].reverse().find((c) => c.type === "dev")?.content
					?? card.description;

				let prUrl: string;
				try {
					prUrl = createGithubPR(worktreePath, card.title, devSummary, card.baseRef);
				} catch (err) {
					// Try to delete the remote branch we just pushed to avoid orphaned branches
					spawnSync("git", ["push", "origin", "--delete", taskBranch], { cwd: worktreePath, stdio: "ignore" });
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PR creation failed: ${err}` });
				}

				await updateCard(workspaceId, cardId, { githubPrUrl: prUrl });
				await appendActivityLog(workspaceId, cardId, `PR created → ${prUrl}`);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return { status: "pr_created" as const, prUrl };
			}),

		update: publicProcedure
			.input(runtimeCardUpdateRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId, revision, ...update } = input;
				const card = await updateCard(workspaceId, cardId, update);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return card;
			}),

		move: publicProcedure
			.input(runtimeCardMoveRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, cardId, targetColumnId, targetIndex } = input;
				const board = await moveCard(workspaceId, cardId, targetColumnId, targetIndex);
				// Reset session so the poller can pick up cards moved back to work columns
				if (targetColumnId === "reopened" || targetColumnId === "ready_for_dev") {
					await updateSession(workspaceId, cardId, { state: "idle" });
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

				await Promise.all([
					deleteCard(workspaceId, cardId),
					removeSession(workspaceId, cardId),
				]);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);

				// Queue cleanup so it never blocks the event loop
				enqueueCleanup(async () => {
					logger.info(`[cleanup:${cardId}] dequeued (${cleanupQueue.length} remaining)`);
					if (card?.githubPrUrl) {
						const t0 = Date.now();
						const { execFile } = await import("node:child_process");
						const { promisify } = await import("node:util");
						const execFileAsync = promisify(execFile);
						try {
							await execFileAsync("gh", ["pr", "close", card.githubPrUrl, "--comment", "Task deleted from kanbom"]);
							logger.info(`[cleanup:${cardId}] gh pr close done (${Date.now() - t0}ms)`);
						} catch (err) {
							logger.error({ err }, `[cleanup:${cardId}] gh pr close failed:`);
						}
					}
					await removeWorktreeAsync(cardId, ws.repoPath);
				});

				return { ok: true };
			}),

		addReviewComment: publicProcedure
			.input(
				z.object({
					workspaceId: z.string(),
					cardId: z.string(),
					content: z.string().min(1),
					type: z.string(),
					agent: z.string().default("claude"),
					passed: z.boolean().optional(),
				}),
			)
			.mutation(async ({ ctx, input }) => {
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const comment = {
					type: input.type,
					agent: input.agent,
					content: input.content,
					passed: input.passed,
					createdAt: Date.now(),
				};
				const updatedComments = [...(card.reviewComments ?? []), comment];
				await updateCard(input.workspaceId, input.cardId, { reviewComments: updatedComments });
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
				return { ok: true, comment };
			}),

		submitHumanFeedback: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string(), comment: z.string().optional() }))
			.mutation(async ({ ctx, input }) => {
				const board = await loadBoard(input.workspaceId);
				const card = board.cards[input.cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const trimmed = input.comment?.trim();
				const updatedComments = trimmed
					? [
						...(card.reviewComments ?? []),
						{ type: "human" as const, agent: "human", content: trimmed, createdAt: Date.now() },
					]
					: (card.reviewComments ?? []);
				await updateCard(input.workspaceId, input.cardId, { reviewComments: updatedComments });
				await moveCard(input.workspaceId, input.cardId, "reopened");
				await updateSession(input.workspaceId, input.cardId, { state: "idle" });
				await appendActivityLog(input.workspaceId, input.cardId, "Human feedback submitted → moved to Reopened");
				ctx.stateHub.broadcastWorkspaceUpdate(input.workspaceId);
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

		getDiff: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.query(async ({ input }) => {
				const { workspaceId, cardId } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find(w => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });

				const board = await loadBoard(workspaceId);
				const card = board.cards[cardId];
				if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found" });

				const worktreePath = getWorktreePath(cardId);
				const { existsSync } = await import("node:fs");
				if (!existsSync(worktreePath)) {
					return { diff: null, error: "No worktree — agent has not started yet" };
				}

				const result = spawnSync(
					"git", ["diff", card.baseRef, "--no-color", "-U3"],
					{ cwd: worktreePath, encoding: "utf-8", maxBuffer: 4 * 1024 * 1024 }
				);

				if (result.status !== 0 && result.stderr) {
					return { diff: null, error: result.stderr.trim() };
				}

				return { diff: result.stdout ?? "", error: null };
			}),
	}),

	// ─── Terminal ──────────────────────────────────────────────────────────────
	terminal: router({
		buffer: publicProcedure
			.input(z.object({ workspaceId: z.string(), taskId: z.string() }))
			.query(({ ctx, input }) => {
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

		listDir: publicProcedure.input(z.object({ path: z.string() })).query(async ({ input }) => {
			const { readdirSync, statSync } = await import("node:fs");
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
	}),

	// ─── Kanban Agent terminal session ───────────────────────────────────
	agent: router({
		startSession: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const scheduler = ctx.getScheduler(input.workspaceId);
				if (!scheduler) {
					await ctx.ensureWorkspace(input.workspaceId);
					const retried = ctx.getScheduler(input.workspaceId);
					if (!retried) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
					return { taskId: await retried.startHomeAgent() };
				}
				return { taskId: await scheduler.startHomeAgent() };
			}),

		stopSession: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.mutation(({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.stopHomeAgent();
			}),

		sessionStatus: publicProcedure
			.input(z.object({ workspaceId: z.string() }))
			.query(({ ctx, input }) => {
				const scheduler = ctx.getScheduler(input.workspaceId);
				if (!scheduler) return { running: false, taskId: null };
				return {
					running: scheduler.isHomeAgentRunning(),
					taskId: scheduler.homeAgentTaskId,
				};
			}),
	}),

	// ─── Jira (per-project) ───────────────────────────────────────────────────
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
							title: `[${ticket.key}] ${ticket.summary}`,
							description,
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
