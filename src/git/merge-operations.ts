import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const WORKTREES_DIR = join(homedir(), ".kanbom", "worktrees");

function git(args: string[], cwd: string): { stdout: string; stderr: string; ok: boolean } {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
	return { stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "", ok: r.status === 0 };
}

export function commitIfDirty(worktreePath: string, message: string): boolean {
	const status = git(["status", "--porcelain"], worktreePath);
	if (!status.stdout) return false;
	git(["add", "-A"], worktreePath);
	git(["commit", "-m", message], worktreePath);
	return true;
}

export interface MergeResult {
	ok: boolean;
	conflictedFiles: string[];
	mergeWorktreePath: string;
}

export function getMergeWorktreePath(taskId: string): string {
	return join(WORKTREES_DIR, `${taskId}-merge`);
}

export function attemptMerge(repoPath: string, taskId: string, taskBranch: string, baseRef: string): MergeResult {
	const mergeWorktreePath = getMergeWorktreePath(taskId);

	if (existsSync(mergeWorktreePath)) {
		git(["worktree", "remove", "--force", mergeWorktreePath], repoPath);
	}

	// Create detached worktree at baseRef — avoids "already checked out" error
	const addResult = git(["worktree", "add", "--detach", mergeWorktreePath, baseRef], repoPath);
	if (!addResult.ok) {
		throw new Error(`Failed to create merge worktree: ${addResult.stderr}`);
	}

	const mergeResult = git(
		["merge", taskBranch, "--no-edit", "--no-ff", "-m", `Merge task: ${taskBranch}`],
		mergeWorktreePath,
	);

	if (mergeResult.ok) {
		const head = git(["rev-parse", "HEAD"], mergeWorktreePath);
		// update-ref works even when the branch is checked out elsewhere
		git(["update-ref", `refs/heads/${baseRef}`, head.stdout], repoPath);
		git(["worktree", "remove", "--force", mergeWorktreePath], repoPath);
		return { ok: true, conflictedFiles: [], mergeWorktreePath: "" };
	}

	const conflictsResult = git(["diff", "--name-only", "--diff-filter=U"], mergeWorktreePath);
	const conflictedFiles = conflictsResult.stdout.split("\n").filter(Boolean);
	return { ok: false, conflictedFiles, mergeWorktreePath };
}

export function finalizeMerge(repoPath: string, mergeWorktreePath: string, baseRef: string): void {
	const head = git(["rev-parse", "HEAD"], mergeWorktreePath);
	git(["update-ref", `refs/heads/${baseRef}`, head.stdout], repoPath);
	git(["worktree", "remove", "--force", mergeWorktreePath], repoPath);
}

export function abortAndCleanupMerge(repoPath: string, mergeWorktreePath: string): void {
	git(["merge", "--abort"], mergeWorktreePath);
	git(["worktree", "remove", "--force", mergeWorktreePath], repoPath);
}

export function pushBranch(worktreePath: string, branch: string): void {
	const r = spawnSync("git", ["push", "-u", "origin", branch], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) throw new Error(`Failed to push: ${r.stderr?.trim()}`);
}

export function createGithubPR(worktreePath: string, title: string, body: string, baseRef: string): string {
	const r = spawnSync("gh", ["pr", "create", "--title", title, "--body", body, "--base", baseRef], {
		cwd: worktreePath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) throw new Error(`Failed to create PR: ${r.stderr?.trim()}`);
	return r.stdout.trim();
}

export interface GithubComment {
	id: string;
	author: string;
	body: string;
	createdAt: string;
}

export interface PRInfo {
	state: "OPEN" | "CLOSED" | "MERGED";
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	author: string;
	comments: GithubComment[];
	reviews: GithubComment[];
}

export function fetchPRInfo(prUrl: string): PRInfo | null {
	// latestReviews = most recent review per reviewer (reliably populated, unlike `reviews`)
	const r = spawnSync("gh", ["pr", "view", prUrl, "--json", "state,author,comments,latestReviews"], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) {
		console.warn(`[fetchPRInfo] gh exited ${r.status} for ${prUrl}: ${r.stderr?.trim()}`);
		return null;
	}
	try {
		const raw = JSON.parse(r.stdout) as {
			state: PRInfo["state"];
			author: { login: string };
			comments: Array<{ id: string; author: { login: string }; body: string; createdAt: string }>;
			latestReviews: Array<{ id: string; author: { login: string }; body: string; submittedAt: string; state: string }>;
		};

		const reviewDecision: PRInfo["reviewDecision"] = raw.latestReviews.some((rv) => rv.state === "CHANGES_REQUESTED")
			? "CHANGES_REQUESTED"
			: raw.latestReviews.some((rv) => rv.state === "APPROVED")
				? "APPROVED"
				: null;

		return {
			state: raw.state,
			author: raw.author?.login ?? "",
			reviewDecision,
			comments: raw.comments
				.filter((c) => c.body?.trim())
				.map((c) => ({
					id: c.id,
					author: c.author?.login ?? "unknown",
					body: c.body,
					createdAt: c.createdAt,
				})),
			reviews: raw.latestReviews
				.filter((rv) => rv.body?.trim())
				.map((rv) => ({
					id: `review-${rv.id}`,
					author: rv.author?.login ?? "unknown",
					body: rv.body,
					createdAt: rv.submittedAt,
				})),
		};
	} catch {
		return null;
	}
}

export function listLocalBranches(repoPath: string): string[] {
	const r = spawnSync("git", ["branch", "--format=%(refname:short)"], {
		cwd: repoPath,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) return [];
	return r.stdout
		.trim()
		.split("\n")
		.filter((b) => b && !b.startsWith("kanbom/"));
}
