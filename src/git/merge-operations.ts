import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import { logger } from "../core/logger.js";

const execFileAsync = promisify(execFile);

const WORKTREES_DIR = join(homedir(), ".whipped", "worktrees");

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

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
	const statusResult = await execFileAsync("git", ["status", "--porcelain"], {
		cwd: worktreePath,
		encoding: "utf-8",
	}).catch(() => null);
	const dirty = !!statusResult?.stdout?.trim();
	logger.info(
		`[git:isWorktreeDirty] path=${worktreePath} dirty=${dirty} output=${JSON.stringify(statusResult?.stdout?.trim())}`,
	);
	return dirty;
}

export async function commitWorktree(worktreePath: string, message: string): Promise<void> {
	logger.info(`[git:commitWorktree] Staging all changes in ${worktreePath}`);
	const _addResult = await execFileAsync("git", ["add", "-A"], { cwd: worktreePath }).catch((err) => {
		logger.error(`[git:commitWorktree] git add -A failed: ${String(err)}`);
		return null;
	});
	logger.info(`[git:commitWorktree] git add -A done. Committing with message: "${message}"`);
	const commitResult = await execFileAsync("git", ["commit", "-m", message], { cwd: worktreePath }).catch((err) => {
		logger.error(`[git:commitWorktree] git commit failed: ${String(err)}`);
		return null;
	});
	logger.info(`[git:commitWorktree] git commit done. stdout=${JSON.stringify((commitResult as any)?.stdout?.trim())}`);
}

export async function commitIfDirty(worktreePath: string, message: string): Promise<boolean> {
	const dirty = await isWorktreeDirty(worktreePath);
	if (!dirty) return false;
	await commitWorktree(worktreePath, message);
	return true;
}

// Stages and commits all changes as a temporary "__whipped_wip__" commit so a
// dependent worktree can branch from it. Returns true if a commit was made.
// Always pair with undoTempCommit() after the dependent worktree is created.
export async function createTempCommit(worktreePath: string): Promise<boolean> {
	const dirty = await isWorktreeDirty(worktreePath);
	if (!dirty) return false;
	await execFileAsync("git", ["add", "-A"], { cwd: worktreePath }).catch(() => {});
	await execFileAsync("git", ["commit", "-m", "__whipped_wip__"], { cwd: worktreePath });
	return true;
}

// Soft-resets the last commit, restoring all changes as staged.
// Used to clean up after createTempCommit once the dependent worktree exists.
export async function undoTempCommit(worktreePath: string): Promise<void> {
	await execFileAsync("git", ["reset", "--soft", "HEAD~1"], { cwd: worktreePath }).catch(() => {});
}

export interface MergeResult {
	ok: boolean;
	conflictedFiles: string[];
	dirtyBase?: boolean;
}

export function attemptMerge(repoPath: string, effectiveWorktreeId: string, taskBranch: string): MergeResult {
	const worktreePath = join(WORKTREES_DIR, effectiveWorktreeId);

	if (existsSync(worktreePath)) {
		rmSync(worktreePath, { recursive: true, force: true });
		git(["worktree", "prune"], repoPath);
	}

	// Refuse early if the base repo has staged or unstaged changes — git merge would
	// reject with a non-conflict error and leave the task branch unmerged.
	const statusResult = git(["status", "--porcelain"], repoPath);
	if (statusResult.stdout.trim()) {
		return { ok: false, conflictedFiles: [], dirtyBase: true };
	}

	const mergeResult = git(["merge", taskBranch, "--no-edit", "--no-ff", "-m", `Merge task: ${taskBranch}`], repoPath);

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
	if (!existsSync(worktreePath)) {
		throw new Error(`Failed to push: worktree path no longer exists (${worktreePath})`);
	}
	await execFileAsync("git", ["push", "-u", "--force-with-lease", "origin", branch], {
		cwd: worktreePath,
		encoding: "utf-8",
	}).catch((err: { stderr?: string; message?: string; code?: string }) => {
		// `??` would keep an empty-string stderr; prefer any non-empty channel.
		const stderr = err.stderr?.trim();
		const message = err.message?.trim();
		const detail = stderr || message || err.code || String(err);
		throw new Error(`Failed to push: ${detail}`);
	});
}

// ─── YOLO mode: merge straight into the local base ref ────────────────────────
//
// Each YOLO merge runs in a fresh, detached, machine-owned scratch worktree so we
// never touch the user's main checkout and never need a destructive reset. The
// base branch is advanced via `update-ref` (working-tree-free); the scratch
// worktree is deleted afterwards. Merges into the same base ref are serialised by
// the caller (merge-queue) so concurrent `update-ref` can't clobber.

const YOLO_DIR = join(WORKTREES_DIR, ".yolo");

export interface YoloMergeResult {
	ok: boolean;
	conflictedFiles: string[];
}

// Creates a fresh detached worktree at baseRef and returns its path. Detached so
// it coexists with the main repo even if that's sitting on baseRef.
export function createYoloWorktree(repoPath: string, workspaceId: string, cardId: string, baseRef: string): string {
	const tmpPath = join(YOLO_DIR, workspaceId, `${cardId}-${Date.now()}`);
	mkdirSync(dirname(tmpPath), { recursive: true });
	git(["worktree", "prune"], repoPath);
	const res = git(["worktree", "add", "--detach", tmpPath, baseRef], repoPath);
	if (!res.ok) throw new Error(`Failed to create YOLO worktree at ${tmpPath}: ${res.stderr}`);
	return tmpPath;
}

// Merges taskBranch into the detached HEAD of the scratch worktree. On conflict the
// merge is left in progress so the resolution agent can fix it in place.
export function yoloMergeIntoBase(tmpPath: string, taskBranch: string): YoloMergeResult {
	const res = git(["merge", taskBranch, "--no-ff", "--no-edit", "-m", `Merge ${taskBranch}`], tmpPath);
	if (res.ok) return { ok: true, conflictedFiles: [] };
	const conflicts = git(["diff", "--name-only", "--diff-filter=U"], tmpPath);
	return { ok: false, conflictedFiles: conflicts.stdout.split("\n").filter(Boolean) };
}

// Advances the local baseRef branch to the scratch worktree's merged HEAD without
// touching any working tree. Returns the new commit sha.
export function finalizeYoloMerge(repoPath: string, baseRef: string, tmpPath: string): string {
	const head = git(["rev-parse", "HEAD"], tmpPath);
	if (!head.ok || !head.stdout) throw new Error("Could not resolve merged HEAD in YOLO worktree");
	const upd = git(["update-ref", `refs/heads/${baseRef}`, head.stdout], repoPath);
	if (!upd.ok) throw new Error(`Failed to advance ${baseRef}: ${upd.stderr}`);
	return head.stdout;
}

// Removes a YOLO scratch worktree. Guarded so it can only ever delete paths inside
// the machine-owned .yolo directory.
export function removeYoloWorktree(repoPath: string, tmpPath: string): void {
	if (!resolve(tmpPath).startsWith(YOLO_DIR + sep)) {
		throw new Error(`Refusing to remove non-YOLO worktree: ${tmpPath}`);
	}
	git(["worktree", "remove", tmpPath, "--force"], repoPath);
	git(["worktree", "prune"], repoPath);
}

// True if the base branch exists on origin (so a push is meaningful). False for
// local-only repos or branches that have never been pushed.
export function remoteBaseBranchExists(repoPath: string, baseRef: string): boolean {
	const res = git(["ls-remote", "--heads", "origin", baseRef], repoPath);
	return res.ok && res.stdout.length > 0;
}

// Plain (non-force) push of the base branch. A rejection means the remote moved —
// surfaced to the caller rather than forced past.
export function pushBaseRef(repoPath: string, baseRef: string): { ok: boolean; error?: string } {
	const res = git(["push", "origin", baseRef], repoPath);
	return res.ok ? { ok: true } : { ok: false, error: res.stderr || "push failed" };
}

// Creates a GitHub PR via the REST API. Requires GITHUB_TOKEN and a GitHub remote.
// Returns the PR HTML URL.
export async function createGithubPR(
	worktreePath: string,
	title: string,
	body: string,
	baseRef: string,
	token: string,
): Promise<string> {
	const remote = getGithubRemote(worktreePath);
	if (!remote) throw new Error("Not a GitHub repository — cannot create PR");

	const head = git(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath).stdout;
	if (!head) throw new Error("Could not determine current branch");

	const octokit = new Octokit({ auth: token });

	try {
		const { data } = await octokit.pulls.create({
			owner: remote.owner,
			repo: remote.repo,
			title,
			body,
			head,
			base: baseRef,
		});
		return data.html_url;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		const status = (err as { status?: number }).status;
		if (status === 401 || msg.toLowerCase().includes("bad credentials")) {
			throw new Error("GitHub token is invalid or expired — update GITHUB_TOKEN in project Settings > Secrets.");
		}
		if (status === 403 || msg.includes("not all refs are readable")) {
			throw new Error(
				"GitHub token lacks required permissions — edit your fine-grained PAT at github.com/settings/personal-access-tokens and add Repository > Contents > Read-only and Pull requests > Read & Write.",
			);
		}
		// PR already exists — find and return the existing PR URL instead of failing
		if (status === 422 && msg.includes("A pull request already exists")) {
			const { data: prs } = await octokit.pulls.list({
				owner: remote.owner,
				repo: remote.repo,
				head: `${remote.owner}:${head}`,
				base: baseRef,
				state: "open",
				per_page: 1,
			});
			if (prs[0]) return prs[0].html_url;
		}
		throw err;
	}
}

// Closes a GitHub PR via the REST API, optionally posting a comment first.
export async function closePR(prUrl: string, token: string): Promise<void> {
	const parsed = parsePRUrl(prUrl);
	if (!parsed) return;
	const octokit = new Octokit({ auth: token });
	const { owner, repo, number: pull_number } = parsed;
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
			pr.mergeable === true ? "MERGEABLE" : pr.mergeable === false ? "CONFLICTING" : "UNKNOWN";

		// Derive review decision from the latest review per user (ignoring comments/dismissed)
		const latestReviewByUser = new Map<string, string>();
		for (const rv of reviewsResp.data) {
			if (rv.state !== "COMMENTED" && rv.state !== "DISMISSED") {
				latestReviewByUser.set(rv.user?.login ?? "", rv.state);
			}
		}
		const reviewStates = Array.from(latestReviewByUser.values());
		const reviewDecision: PRInfo["reviewDecision"] = reviewStates.includes("CHANGES_REQUESTED")
			? "CHANGES_REQUESTED"
			: reviewStates.includes("APPROVED")
				? "APPROVED"
				: null;

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
		.filter((b) => b && !b.startsWith("task/") && !b.startsWith("whipped/") && !b.startsWith("kanbom/"));
}

// Fetches body_html for a single issue comment, which contains pre-signed CDN URLs
// for private GitHub attachment images. Only call this for new, unseen comments.
export async function fetchCommentBodyHtml(
	prUrl: string,
	commentId: string,
	token: string,
): Promise<string | undefined> {
	const parsed = parsePRUrl(prUrl);
	if (!parsed) return undefined;
	const octokit = new Octokit({ auth: token });
	try {
		const resp = await octokit.request("GET /repos/{owner}/{repo}/issues/comments/{comment_id}", {
			owner: parsed.owner,
			repo: parsed.repo,
			comment_id: Number(commentId),
			headers: { accept: "application/vnd.github.full+json" },
		});
		return (resp.data as { body_html?: string }).body_html;
	} catch (err) {
		logger.warn({ err }, `[gh-images] failed to fetch body_html for comment ${commentId}`);
		return undefined;
	}
}
