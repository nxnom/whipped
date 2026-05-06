import { logger } from "../core/logger.js";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";

const execFileAsync = promisify(execFile);

const WORKTREES_DIR = join(homedir(), ".kanbom", "worktrees");

function git(args: string[], cwd: string): { stdout: string; stderr: string; ok: boolean } {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
	return { stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "", ok: r.status === 0 };
}

function parsePRUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
	const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (!match) return null;
	return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

// Returns owner/repo if the worktree's origin remote is GitHub, otherwise null.
function getGithubRemote(cwd: string): { owner: string; repo: string } | null {
	const r = git(["remote", "get-url", "origin"], cwd);
	if (!r.ok) return null;
	const url = r.stdout;
	const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (!match) return null;
	return { owner: match[1]!, repo: match[2]! };
}

export async function commitIfDirty(worktreePath: string, message: string): Promise<boolean> {
	const statusResult = await execFileAsync("git", ["status", "--porcelain"], { cwd: worktreePath, encoding: "utf-8" }).catch(() => null);
	if (!statusResult?.stdout?.trim()) return false;
	await execFileAsync("git", ["add", "-A"], { cwd: worktreePath }).catch(() => {});
	await execFileAsync("git", ["commit", "-m", message], { cwd: worktreePath }).catch(() => {});
	return true;
}

export interface MergeResult {
	ok: boolean;
	conflictedFiles: string[];
}

export function attemptMerge(repoPath: string, taskId: string, taskBranch: string): MergeResult {
	const worktreePath = join(WORKTREES_DIR, taskId);

	if (existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
		git(["worktree", "prune"], repoPath);
	}

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

// Plain git push — works for any remote (GitHub, GitLab, Bitbucket, SSH, etc.)
// Auth is handled by the user's git credential store or SSH key.
export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
	await execFileAsync("git", ["push", "-u", "origin", branch], { cwd: worktreePath, encoding: "utf-8" }).catch((err: { stderr?: string }) => {
		throw new Error(`Failed to push: ${(err.stderr ?? String(err)).trim()}`);
	});
}

// Creates a GitHub PR via the REST API. Requires GITHUB_TOKEN and a GitHub remote.
// Returns the PR HTML URL.
export async function createGithubPR(worktreePath: string, title: string, body: string, baseRef: string, token: string): Promise<string> {
	const remote = getGithubRemote(worktreePath);
	if (!remote) throw new Error("Not a GitHub repository — cannot create PR");

	const head = git(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath).stdout;
	if (!head) throw new Error("Could not determine current branch");

	const octokit = new Octokit({ auth: token });
	const { data } = await octokit.pulls.create({
		owner: remote.owner,
		repo: remote.repo,
		title,
		body,
		head,
		base: baseRef,
	});
	return data.html_url;
}

// Closes a GitHub PR via the REST API, optionally posting a comment first.
export async function closePR(prUrl: string, comment: string, token: string): Promise<void> {
	const parsed = parsePRUrl(prUrl);
	if (!parsed) return;
	const octokit = new Octokit({ auth: token });
	const { owner, repo, number: pull_number } = parsed;
	await octokit.issues.createComment({ owner, repo, issue_number: pull_number, body: comment }).catch((err) => {
		logger.warn(`[closePR] Failed to post comment on ${prUrl}: ${String(err)}`);
	});
	await octokit.pulls.update({ owner, repo, pull_number, state: "closed" }).catch((err) => {
		logger.warn(`[closePR] Failed to close ${prUrl}: ${String(err)}`);
	});
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

// Fetches PR info via the GitHub REST API. Returns null if no token or not a GitHub PR URL.
export async function fetchPRInfo(prUrl: string, token?: string): Promise<PRInfo | null> {
	if (!token) return null;
	const parsed = parsePRUrl(prUrl);
	if (!parsed) return null;

	const octokit = new Octokit({ auth: token });
	const { owner, repo, number: pull_number } = parsed;

	try {
		const [prResp, reviewsResp, commentsResp, reviewCommentsResp] = await Promise.all([
			octokit.pulls.get({ owner, repo, pull_number }),
			octokit.pulls.listReviews({ owner, repo, pull_number, per_page: 100 }),
			octokit.issues.listComments({ owner, repo, issue_number: pull_number, per_page: 100 }),
			octokit.pulls.listReviewComments({ owner, repo, pull_number, per_page: 100 }),
		]);

		const pr = prResp.data;

		const state: PRInfo["state"] = pr.merged_at ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN";

		const mergeable: PRInfo["mergeable"] =
			pr.mergeable === true ? "MERGEABLE" :
			pr.mergeable === false ? "CONFLICTING" : "UNKNOWN";

		// Derive review decision from the latest review per user (ignoring comments/dismissed)
		const latestReviewByUser = new Map<string, string>();
		for (const rv of reviewsResp.data) {
			if (rv.state !== "COMMENTED" && rv.state !== "DISMISSED") {
				latestReviewByUser.set(rv.user?.login ?? "", rv.state);
			}
		}
		const reviewStates = Array.from(latestReviewByUser.values());
		const reviewDecision: PRInfo["reviewDecision"] =
			reviewStates.includes("CHANGES_REQUESTED") ? "CHANGES_REQUESTED" :
			reviewStates.includes("APPROVED") ? "APPROVED" : null;

		const comments: GithubComment[] = commentsResp.data
			.filter((c) => c.body?.trim())
			.map((c) => ({
				id: String(c.id),
				author: c.user?.login ?? "unknown",
				body: c.body ?? "",
				createdAt: c.created_at,
			}));

		const inlineComments: GithubComment[] = reviewCommentsResp.data
			.filter((c) => c.body?.trim())
			.map((c) => ({
				id: `inline-${c.id}`,
				author: c.user?.login ?? "unknown",
				body: `**${c.path}${c.line ? `:${c.line}` : ""}**\n${c.body}`,
				createdAt: c.created_at,
			}));

		const reviewBodies: GithubComment[] = reviewsResp.data
			.filter((rv) => rv.body?.trim())
			.map((rv) => ({
				id: `review-${rv.id}`,
				author: rv.user?.login ?? "unknown",
				body: rv.body ?? "",
				createdAt: rv.submitted_at ?? "",
			}));

		return {
			state,
			mergeable,
			author: pr.user?.login ?? "",
			reviewDecision,
			comments,
			reviews: [...reviewBodies, ...inlineComments],
		};
	} catch (err) {
		logger.warn(`[fetchPRInfo] API error for ${prUrl}: ${String(err)}`);
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
