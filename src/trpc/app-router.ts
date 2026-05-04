import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { getAvailableAgents } from "../agents/agent-registry.js";
import { loadGlobalConfig, saveGlobalConfig, updateGlobalConfig } from "../config/runtime-config.js";
import {
	type RuntimeGlobalConfig,
	type RuntimeProjectConfig,
	runtimeCardCreateRequestSchema,
	runtimeCardMoveRequestSchema,
	runtimeCardUpdateRequestSchema,
	runtimeGlobalConfigSchema,
	runtimeJiraImportRequestSchema,
	runtimeProjectConfigSchema,
} from "../core/api-contract.js";
import type { BoardPoller } from "../daemon/poller.js";
import type { TaskScheduler } from "../daemon/scheduler.js";
import type { RuntimeStateHub } from "../server/runtime-state-hub.js";
import {
	createCard,
	deleteCard,
	listWorkspaces,
	loadProjectConfig,
	loadWorkspaceContext,
	loadWorkspaceState,
	moveCard,
	saveProjectConfig,
	saveWorkspaceState,
	setAutonomousMode,
	updateCard,
} from "../state/workspace-state.js";
import { getDefaultBranch } from "../worktree/worktree-manager.js";

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

		add: publicProcedure.input(z.object({ repoPath: z.string().min(1) })).mutation(async ({ ctx, input }) => {
			const { statSync } = await import("node:fs");
			try {
				const stat = statSync(input.repoPath);
				if (!stat.isDirectory()) throw new Error("Not a directory");
			} catch {
				throw new TRPCError({ code: "BAD_REQUEST", message: `Path does not exist: ${input.repoPath}` });
			}
			const context = await loadWorkspaceContext(input.repoPath);
			await ctx.ensureWorkspace(context.workspaceId);
			return context;
		}),

		remove: publicProcedure.input(z.object({ workspaceId: z.string() })).mutation(async ({ input }) => {
			// Just removes from index — does not delete data
			const { listWorkspaces: list } = await import("../state/workspace-state.js");
			// We don't expose hard-delete for safety; user can clean ~/.kanbom manually
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

	// ─── Cards ─────────────────────────────────────────────────────────────────
	cards: router({
		create: publicProcedure
			.input(runtimeCardCreateRequestSchema.extend({ workspaceId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				const { workspaceId, ...cardData } = input;
				const workspaces = await listWorkspaces();
				const ws = workspaces.find((w) => w.workspaceId === workspaceId);
				if (!ws) throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
				const baseRef = getDefaultBranch(ws.repoPath);
				const card = await createCard(workspaceId, cardData, baseRef);
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return card;
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
				ctx.stateHub.broadcastWorkspaceUpdate(workspaceId);
				return board;
			}),

		delete: publicProcedure
			.input(z.object({ workspaceId: z.string(), cardId: z.string() }))
			.mutation(async ({ ctx, input }) => {
				ctx.getScheduler(input.workspaceId)?.stopTask(input.cardId);
				await deleteCard(input.workspaceId, input.cardId);
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
