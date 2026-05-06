import { logger } from "../core/logger.js";
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

function parsePRUrl(prUrl: string): { owner: string; repo: string; number: string } | null {
	const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (!match) return null;
	return { owner: match[1], repo: match[2], number: match[3] };
}

export function fetchPRInfo(prUrl: string): PRInfo | null {
	const r = spawnSync("gh", ["pr", "view", prUrl, "--json", "state,mergeable,reviewDecision,author,comments,latestReviews"], {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (r.status !== 0) {
		logger.warn(`[fetchPRInfo] gh exited ${r.status} for ${prUrl}: ${r.stderr?.trim()}`);
		return null;
	}
	try {
		const raw = JSON.parse(r.stdout) as {
			state: PRInfo["state"];
			mergeable: PRInfo["mergeable"];
			reviewDecision: string | null;
			author: { login: string };
			comments: Array<{ id: string; author: { login: string }; body: string; createdAt: string }>;
			latestReviews: Array<{ id: string; author: { login: string }; body: string; submittedAt: string; state: string }>;
		};

		const reviewDecision: PRInfo["reviewDecision"] =
			raw.reviewDecision === "CHANGES_REQUESTED" ? "CHANGES_REQUESTED"
			: raw.reviewDecision === "APPROVED" ? "APPROVED"
			: null;

		// Fetch inline review comments via REST — not available in gh pr view fields
		const inlineComments: GithubComment[] = [];
		const parsed = parsePRUrl(prUrl);
		if (parsed) {
			const rc = spawnSync(
				"gh", ["api", `repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/comments`, "--paginate"],
				{ encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
			);
			if (rc.status === 0) {
				try {
					const items = JSON.parse(rc.stdout) as Array<{
						id: number;
						user: { login: string };
						body: string;
						created_at: string;
						path: string;
						line: number | null;
					}>;
					for (const item of items) {
						if (item.body?.trim()) {
							inlineComments.push({
								id: `inline-${item.id}`,
								author: item.user?.login ?? "unknown",
								body: `**${item.path}${item.line ? `:${item.line}` : ""}**\n${item.body}`,
								createdAt: item.created_at,
							});
						}
					}
				} catch {}
			}
		}

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
			reviews: [
				...raw.latestReviews
					.filter((rv) => rv.body?.trim())
					.map((rv) => ({
						id: `review-${rv.id}`,
						author: rv.author?.login ?? "unknown",
						body: rv.body,
						createdAt: rv.submittedAt,
					})),
				...inlineComments,
			],
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
