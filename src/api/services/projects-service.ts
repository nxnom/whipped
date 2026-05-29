import { spawnSync } from "node:child_process";
import { ATTACHMENTS_DIR, WORKSPACES_DIR } from "../../config/runtime-config.js";
import type { RuntimeBoardCard, RuntimeProjectConfig } from "../../core/api-contract.js";
import { runtimeProjectConfigSchema } from "../../core/api-contract.js";
import { logger } from "../../core/logger.js";
import { loadProjectsLayout, type ProjectsLayout, saveProjectsLayout } from "../../state/projects-layout.js";
import {
	listWorkspaces,
	loadBoard,
	loadWorkspaceContext,
	removeWorkspace,
	updateProjectConfig,
	type WorkspaceContext,
} from "../../state/workspace-state.js";
import { removeWorktreeAsync } from "../../worktree/worktree-manager.js";
import { BadRequestError } from "../errors/http-errors.js";

// All worktree removals run serially in this queue so they never block the
// event loop (each step uses async I/O) and never contend on the git lock.
const cleanupQueue: (() => Promise<void>)[] = [];
let cleanupRunning = false;

function enqueueCleanup(fn: () => Promise<void>): void {
	cleanupQueue.push(fn);
	if (!cleanupRunning) void drainCleanupQueue();
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

export const listProjects = async (): Promise<WorkspaceContext[]> => listWorkspaces();

export const getProjectsLayout = (): ProjectsLayout => loadProjectsLayout();

export const saveProjectsLayoutData = (layout: ProjectsLayout): { ok: true } => {
	saveProjectsLayout(layout);
	return { ok: true };
};

export const checkProjectPath = async (repoPath: string) => {
	if (!repoPath.trim()) return { valid: false, isGitRepo: false, error: null, name: null, branch: null, remote: null };
	const { statSync } = await import("node:fs");
	try {
		const stat = statSync(repoPath);
		if (!stat.isDirectory())
			return { valid: false, isGitRepo: false, error: "Not a directory", name: null, branch: null, remote: null };
	} catch {
		return { valid: false, isGitRepo: false, error: "Path does not exist", name: null, branch: null, remote: null };
	}
	const r = spawnSync("git", ["rev-parse", "--git-dir"], {
		cwd: repoPath,
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
		cwd: repoPath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const remoteR = spawnSync("git", ["remote", "get-url", "origin"], {
		cwd: repoPath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const name = repoPath.split("/").filter(Boolean).at(-1) ?? null;
	const branch = branchR.status === 0 ? branchR.stdout.trim() : null;
	const rawRemote = remoteR.status === 0 ? remoteR.stdout.trim() : null;
	const remote = rawRemote
		? rawRemote
				.replace(/^https?:\/\//, "")
				.replace(/^git@([^:]+):/, "$1/")
				.replace(/\.git$/, "")
		: null;
	return { valid: true, isGitRepo: true, error: null, name, branch, remote };
};

export const addProject = async (
	repoPath: string,
	initialConfig?: Partial<RuntimeProjectConfig>,
): Promise<WorkspaceContext> => {
	const { statSync } = await import("node:fs");
	try {
		const stat = statSync(repoPath);
		if (!stat.isDirectory()) throw new Error("Not a directory");
	} catch {
		throw BadRequestError(`Path does not exist: ${repoPath}`);
	}
	const r = spawnSync("git", ["rev-parse", "--git-dir"], {
		cwd: repoPath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) throw BadRequestError("Not a git repository");
	const context = await loadWorkspaceContext(repoPath);
	if (initialConfig) {
		await updateProjectConfig(context.workspaceId, (current) =>
			runtimeProjectConfigSchema.parse({ ...current, ...initialConfig }),
		);
	}
	return context;
};

// Removes a workspace from the index and queues async cleanup of its worktrees
// and data files. The caller (controller) stops the scheduler/run session via
// ctx before invoking this and broadcasts afterwards.
export const removeProject = async (workspaceId: string): Promise<{ ok: true }> => {
	// Get workspace info before removing (repoPath needed for worktree cleanup)
	const allWorkspaces = await listWorkspaces();
	const ws = allWorkspaces.find((w) => w.workspaceId === workspaceId);

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
};
