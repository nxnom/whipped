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
}

export function attemptMerge(repoPath: string, taskId: string, taskBranch: string): MergeResult {
	const worktreePath = join(WORKTREES_DIR, taskId);

	// Remove the worktree directory but keep the branch so we can merge it
	if (existsSync(worktreePath)) {
		git(["worktree", "remove", "--force", worktreePath], repoPath);
	}

	// Merge directly in the main repo — index and working tree updated naturally
	const mergeResult = git(
		["merge", taskBranch, "--no-edit", "--no-ff", "-m", `Merge task: ${taskBranch}`],
		repoPath,
	);

	if (mergeResult.ok) {
		git(["branch", "-D", taskBranch], repoPath);
		return { ok: true, conflictedFiles: [] };
	}

	const conflictsResult = git(["diff", "--name-only", "--diff-filter=U"], repoPath);
	const conflictedFiles = conflictsResult.stdout.split("\n").filter(Boolean);
	return { ok: false, conflictedFiles };
}

export function finalizeMerge(repoPath: string, taskBranch: string): void {
	git(["branch", "-D", taskBranch], repoPath);
}

export function abortMerge(repoPath: string): void {
	git(["merge", "--abort"], repoPath);
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
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
	author: string;
	comments: GithubComment[];
	reviews: GithubComment[];
}

export function fetchPRInfo(prUrl: string): PRInfo | null {
	// latestReviews = most recent review per reviewer (reliably populated, unlike `reviews`)
	const r = spawnSync("gh", ["pr", "view", prUrl, "--json", "state,mergeable,author,comments,latestReviews"], {
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
			mergeable: PRInfo["mergeable"];
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
			mergeable: raw.mergeable ?? "UNKNOWN",
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
