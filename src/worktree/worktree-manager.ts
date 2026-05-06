import { execFile, execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../core/logger.js";

const execFileAsync = promisify(execFile);

const WORKTREES_DIR = join(homedir(), ".kanbom", "worktrees");

function git(args: string[], cwd: string): { stdout: string; ok: boolean } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { stdout: result.stdout?.trim() ?? "", ok: result.status === 0 };
}

export interface WorktreeInfo {
	taskId: string;
	path: string;
	branch: string;
}

export interface WorktreeCreateResult extends WorktreeInfo {
	isNew: boolean;
}

export function createWorktree(taskId: string, repoPath: string, baseRef: string): WorktreeCreateResult {
	mkdirSync(WORKTREES_DIR, { recursive: true });

	const branch = `kanbom/task-${taskId}`;
	const worktreePath = join(WORKTREES_DIR, taskId);

	// Reuse existing worktree so retries (reopened cards) build on prior work
	if (existsSync(worktreePath)) {
		return { taskId, path: worktreePath, branch, isNew: false };
	}

	// Prune stale git refs in case a previous run left the worktree deregistered
	git(["worktree", "prune"], repoPath);

	const branchCheck = git(["branch", "--list", branch], repoPath);
	const branchExists = branchCheck.stdout.includes(branch);

	if (branchExists) {
		const r = git(["worktree", "add", worktreePath, branch], repoPath);
		if (!r.ok) throw new Error(`Failed to add worktree at ${worktreePath}`);
	} else {
		const r = git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoPath);
		if (!r.ok) throw new Error(`Failed to create worktree branch ${branch} at ${worktreePath}`);
	}

	return { taskId, path: worktreePath, branch, isNew: true };
}

export function removeWorktree(taskId: string, repoPath: string): void {
	const worktreePath = join(WORKTREES_DIR, taskId);
	const branch = `kanbom/task-${taskId}`;

	const removeResult = git(["worktree", "remove", "--force", worktreePath], repoPath);
	if (!removeResult.ok && existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
	}
	git(["worktree", "prune"], repoPath);
	git(["branch", "-D", branch], repoPath); // ignore result — branch may not exist
}

export async function removeWorktreeAsync(taskId: string, repoPath: string): Promise<void> {
	const worktreePath = join(WORKTREES_DIR, taskId);
	const branch = `kanbom/task-${taskId}`;

	const t0 = Date.now();
	logger.info(`[cleanup:${taskId}] starting worktree removal`);

	// Step 1: delete the directory first — prune only removes refs whose path is gone
	try {
		await rm(worktreePath, { recursive: true, force: true });
		logger.info(`[cleanup:${taskId}] rm worktree dir done (${Date.now() - t0}ms)`);
	} catch (err) {
		logger.error({ err }, `[cleanup:${taskId}] rm worktree dir failed:`);
	}

	// Step 2: prune stale ref — path is now gone so git will clean it up
	await execFileAsync("git", ["worktree", "prune"], { cwd: repoPath }).catch((err) => {
		logger.error({ err }, `[cleanup:${taskId}] git worktree prune failed:`);
	});

	// Step 3: delete branch ref — safe now that worktree ref is pruned
	try {
		await execFileAsync("git", ["branch", "-D", branch], { cwd: repoPath });
		logger.info(`[cleanup:${taskId}] git branch -D done (${Date.now() - t0}ms)`);
	} catch (err) {
		logger.error({ err }, `[cleanup:${taskId}] git branch -D failed:`);
	}

	logger.info(`[cleanup:${taskId}] done in ${Date.now() - t0}ms`);
}

export function getWorktreePath(taskId: string): string {
	return join(WORKTREES_DIR, taskId);
}

export function getWorktreeBranch(taskId: string): string {
	return `kanbom/task-${taskId}`;
}

export function getDefaultBranch(repoPath: string): string {
	const result = git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
	return result.ok ? result.stdout : "main";
}

export function getCurrentCommitHash(worktreePath: string): string {
	const result = git(["rev-parse", "HEAD"], worktreePath);
	return result.ok ? result.stdout : "";
}
