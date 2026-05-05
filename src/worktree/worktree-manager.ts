import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
		git(["worktree", "add", worktreePath, branch], repoPath);
	} else {
		git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoPath);
	}

	return { taskId, path: worktreePath, branch, isNew: true };
}

export function removeWorktree(taskId: string, repoPath: string): void {
	const worktreePath = join(WORKTREES_DIR, taskId);
	const branch = `kanbom/task-${taskId}`;

	try {
		git(["worktree", "remove", "--force", worktreePath], repoPath);
	} catch {
		if (existsSync(worktreePath)) {
			rmSync(worktreePath, { recursive: true, force: true });
		}
	}

	try {
		git(["branch", "-D", branch], repoPath);
	} catch {
		// ignore
	}
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
