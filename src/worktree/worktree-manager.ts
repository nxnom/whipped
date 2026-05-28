import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../core/logger.js";

const execFileAsync = promisify(execFile);

const WORKTREES_DIR = join(homedir(), ".whipped", "worktrees");

function git(args: string[], cwd: string): { stdout: string; stderr: string; ok: boolean } {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { stdout: result.stdout?.trim() ?? "", stderr: result.stderr?.trim() ?? "", ok: result.status === 0 };
}

export function titleToSnakeCase(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 50);
}

export function titleToBranch(title: string): string {
	return (
		"feat/" +
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 50)
	);
}

export function getCardBranch(card: { id: string; branchName?: string }): string {
	return card.branchName ?? getWorktreeBranch(card.id);
}

export interface WorktreeInfo {
	taskId: string;
	path: string;
	branch: string;
}

export interface WorktreeCreateResult extends WorktreeInfo {
	isNew: boolean;
	conflictedFiles: string[];
}

export function createWorktree(
	taskId: string,
	repoPath: string,
	baseRef: string,
	branchName?: string,
): WorktreeCreateResult {
	mkdirSync(WORKTREES_DIR, { recursive: true });

	let branch = branchName ?? `task/${taskId}`;
	const worktreePath = join(WORKTREES_DIR, taskId);

	logger.info(`[worktree:create] taskId=${taskId} branch=${branch} baseRef=${baseRef} worktreePath=${worktreePath}`);

	// Reuse existing worktree so retries (reopened cards) build on prior work
	if (existsSync(worktreePath)) {
		// Detect the actual git branch so callers always get the real branch name
		const actualBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
		const resolvedBranch = actualBranch.ok && actualBranch.stdout ? actualBranch.stdout : branch;
		logger.info(`[worktree:create] Worktree already exists — reusing (branch: ${resolvedBranch})`);
		return { taskId, path: worktreePath, branch: resolvedBranch, isNew: false, conflictedFiles: [] };
	}

	// Prune stale git refs in case a previous run left the worktree deregistered
	git(["worktree", "prune"], repoPath);

	// Best-effort sync baseRef with remote so the new worktree starts from the latest available state.
	const fetchResult = git(["fetch", "origin", baseRef], repoPath);
	if (!fetchResult.ok) {
		logger.warn(`[worktree:create] Could not fetch origin/${baseRef} — proceeding with local state`);
	} else {
		const switchResult = git(["switch", baseRef], repoPath);
		if (!switchResult.ok) {
			logger.warn(`[worktree:create] Could not switch to ${baseRef} — skipping remote sync`);
		} else {
			const current = git(["rev-parse", baseRef], repoPath).stdout.trim();
			const remote = git(["rev-parse", `origin/${baseRef}`], repoPath).stdout.trim();
			const mergeBase = git(["merge-base", baseRef, `origin/${baseRef}`], repoPath).stdout.trim();

			if (current === remote) {
				// already in sync
			} else if (current === mergeBase) {
				// local is purely behind remote — fast-forward
				git(["merge", "--ff-only", `origin/${baseRef}`], repoPath);
			} else if (remote === mergeBase) {
				// local is ahead of remote (e.g. from local merges) — nothing to do
			} else {
				// diverged — merge remote in, abort on conflict
				const mergeResult = git(
					["merge", "--no-ff", "-m", `Merge remote origin/${baseRef}`, `origin/${baseRef}`],
					repoPath,
				);
				if (!mergeResult.ok) {
					git(["merge", "--abort"], repoPath);
					logger.warn(`[worktree:create] Could not merge origin/${baseRef} into local — proceeding with local state`);
				}
			}
		}
	}

	const branchCheck = git(["branch", "--list", branch], repoPath);
	const branchExists = branchCheck.stdout.includes(branch);
	logger.info(`[worktree:create] branchExists=${branchExists}`);

	if (branchExists) {
		logger.info(`[worktree:create] Running: git worktree add ${worktreePath} ${branch}`);
		const r = git(["worktree", "add", worktreePath, branch], repoPath);
		logger.info(
			`[worktree:create] git worktree add result: ok=${r.ok} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
		);
		if (!r.ok) {
			// Parse which worktree currently holds this branch
			const conflictMatch = r.stderr.match(/already used by worktree at '([^']+)'/);
			const conflictPath = conflictMatch?.[1];
			if (conflictPath && existsSync(conflictPath)) {
				// Branch is live in another worktree — generate a unique branch name for this card
				const uniqueBranch = `${branch}-${taskId.slice(0, 7)}`;
				logger.warn(`[worktree:create] Branch collision with ${conflictPath} — using unique branch ${uniqueBranch}`);
				git(["branch", "-D", uniqueBranch], repoPath); // clean up if it exists from a prior attempt
				const r2 = git(["worktree", "add", "-b", uniqueBranch, worktreePath, baseRef], repoPath);
				if (!r2.ok) throw new Error(`Failed to add worktree at ${worktreePath}: ${r2.stderr}`);
				branch = uniqueBranch;
			} else {
				// Branch is orphaned (worktree directory removed). Prune and recreate.
				logger.warn(`[worktree:create] Orphaned branch — pruning and recreating`);
				git(["worktree", "prune"], repoPath);
				const r2 = git(["worktree", "add", worktreePath, branch], repoPath);
				if (!r2.ok) {
					git(["branch", "-D", branch], repoPath);
					const r3 = git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoPath);
					if (!r3.ok) throw new Error(`Failed to add worktree at ${worktreePath}: ${r3.stderr}`);
				}
			}
		}
	} else {
		logger.info(`[worktree:create] Running: git worktree add -b ${branch} ${worktreePath} ${baseRef}`);
		const r = git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoPath);
		logger.info(
			`[worktree:create] git worktree add -b result: ok=${r.ok} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`,
		);
		if (!r.ok) throw new Error(`Failed to create worktree branch ${branch} at ${worktreePath}`);
	}

	logger.info(`[worktree:create] Done — new worktree at ${worktreePath} on branch ${branch}`);
	return { taskId, path: worktreePath, branch, isNew: true, conflictedFiles: [] };
}

// Creates a worktree from baseRef and merges in any additional dependency branches.
// Used when a card depends on multiple independent tickets so all code is present.
export function createMergedWorktree(
	taskId: string,
	repoPath: string,
	baseRef: string,
	extraBranches: string[],
	branchName?: string,
): WorktreeCreateResult {
	mkdirSync(WORKTREES_DIR, { recursive: true });

	const branch = branchName ?? `task/${taskId}`;
	const worktreePath = join(WORKTREES_DIR, taskId);

	if (existsSync(worktreePath)) {
		return { taskId, path: worktreePath, branch, isNew: false, conflictedFiles: [] };
	}

	git(["worktree", "prune"], repoPath);

	const branchCheck = git(["branch", "--list", branch], repoPath);
	const branchExists = branchCheck.stdout.includes(branch);

	if (branchExists) {
		const r = git(["worktree", "add", worktreePath, branch], repoPath);
		if (!r.ok) throw new Error(`Failed to add worktree at ${worktreePath}`);
		return { taskId, path: worktreePath, branch, isNew: false, conflictedFiles: [] };
	}

	const r = git(["worktree", "add", "-b", branch, worktreePath, baseRef], repoPath);
	if (!r.ok) throw new Error(`Failed to create worktree branch ${branch} at ${worktreePath}`);

	for (const mergeBranch of extraBranches) {
		const mergeResult = git(["merge", "--no-edit", mergeBranch], worktreePath);
		if (!mergeResult.ok) {
			// Leave the worktree in the conflicted state so the resolution agent can fix it.
			const conflictsOut = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], {
				cwd: worktreePath,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			const conflictedFiles = conflictsOut.stdout.trim().split("\n").filter(Boolean);
			logger.warn(`[worktree] Merge conflict merging ${mergeBranch} into ${branch}: ${conflictedFiles.join(", ")}`);
			return { taskId, path: worktreePath, branch, isNew: true, conflictedFiles };
		}
	}

	return { taskId, path: worktreePath, branch, isNew: true, conflictedFiles: [] };
}

export function removeWorktree(taskId: string, repoPath: string, branchName?: string): void {
	const worktreePath = join(WORKTREES_DIR, taskId);
	const branch = branchName ?? `task/${taskId}`;

	const removeResult = git(["worktree", "remove", "--force", worktreePath], repoPath);
	if (!removeResult.ok && existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
	}
	git(["worktree", "prune"], repoPath);
	git(["branch", "-D", branch], repoPath); // ignore result — branch may not exist
}

export async function removeWorktreeAsync(taskId: string, repoPath: string, branchName?: string): Promise<void> {
	const worktreePath = join(WORKTREES_DIR, taskId);
	const branch = branchName ?? `task/${taskId}`;

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

// Returns the worktree owner ID — sharedWorktreeId when set, otherwise the card's own ID.
export function getEffectiveWorktreeId(cardId: string, sharedWorktreeId?: string): string {
	return sharedWorktreeId ?? cardId;
}

export function getWorktreeBranch(taskId: string): string {
	return `task/${taskId}`;
}

export function getDefaultBranch(repoPath: string): string {
	const remote = git(["rev-parse", "--abbrev-ref", "origin/HEAD"], repoPath);
	if (remote.ok && remote.stdout.startsWith("origin/")) {
		return remote.stdout.slice("origin/".length);
	}
	const local = git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
	return local.ok && local.stdout !== "HEAD" ? local.stdout : "main";
}

export function getCurrentCommitHash(worktreePath: string): string {
	const result = git(["rev-parse", "HEAD"], worktreePath);
	return result.ok ? result.stdout : "";
}
