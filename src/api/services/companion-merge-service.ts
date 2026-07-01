import {
	abortMerge,
	attemptMerge,
	commitWorktree,
	createGithubPR,
	getCurrentBranch,
	isWorktreeDirty,
	pushBranch,
} from "../../git/merge-operations.js";
import type { TaskScheduler } from "../../daemon/scheduler.js";
import {
	getCompanionSession,
	setCompanionSessionStatus,
	setCompanionSessionWorktreePath,
} from "../../state/companion-sessions-store.js";
import { loadProjectConfig } from "../../state/workspace-state.js";
import { BadRequestError, NotFoundError } from "../errors/http-errors.js";

export type CommitAndMergeCompanionResult =
	| { status: "needs_commit" }
	| { status: "merged" }
	| { status: "dirty_base" }
	| { status: "conflict"; conflictedFiles: string[] };

// Merging deletes the companion's worktree directory unconditionally (win or
// lose — see attemptMerge), so the interactive agent process must be fully
// stopped first: a still-live process with cwd inside that directory would
// otherwise race the deletion.
export async function commitAndMergeCompanionService(
	id: string,
	repoPath: string,
	commitMessage: string | undefined,
	scheduler: TaskScheduler | undefined,
): Promise<CommitAndMergeCompanionResult> {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");
	if (!session.useWorktree || !session.branchName) {
		throw BadRequestError("This session works directly in the main repo — there's nothing to merge");
	}
	if (!session.worktreePath) throw BadRequestError("Session has no worktree to merge");

	await scheduler?.stopCompanionAgent(id);

	const dirty = await isWorktreeDirty(session.worktreePath);
	if (dirty) {
		if (!commitMessage) return { status: "needs_commit" };
		await commitWorktree(session.worktreePath, commitMessage);
	}

	const result = attemptMerge(repoPath, id, session.branchName);
	// attemptMerge deletes the worktree directory up front regardless of outcome.
	setCompanionSessionWorktreePath(id, null);

	if (result.dirtyBase) {
		setCompanionSessionStatus(id, "stopped");
		return { status: "dirty_base" };
	}
	if (!result.ok) {
		abortMerge(repoPath);
		setCompanionSessionStatus(id, "stopped");
		return { status: "conflict", conflictedFiles: result.conflictedFiles };
	}

	setCompanionSessionStatus(id, "merged");
	return { status: "merged" };
}

export type CommitAndPRCompanionResult =
	| { status: "needs_commit" }
	| { status: "no_token" }
	| { status: "pr_created"; prUrl: string };

export async function commitAndPRCompanionService(
	id: string,
	workspaceId: string,
	commitMessage: string | undefined,
	title: string,
	description: string,
	baseRefOverride: string | undefined,
): Promise<CommitAndPRCompanionResult> {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");
	if (!session.worktreePath) throw BadRequestError("Session has no worktree");

	const projectConfig = await loadProjectConfig(workspaceId);
	const token = projectConfig.secrets?.find((s) => s.key === "GITHUB_TOKEN")?.value;
	if (!token) return { status: "no_token" };

	const dirty = await isWorktreeDirty(session.worktreePath);
	if (dirty) {
		if (!commitMessage) return { status: "needs_commit" };
		await commitWorktree(session.worktreePath, commitMessage);
	}

	const branch = session.branchName ?? getCurrentBranch(session.worktreePath);
	if (!branch) throw BadRequestError("Could not determine the current branch to push");
	await pushBranch(session.worktreePath, branch);
	const prUrl = await createGithubPR(
		session.worktreePath,
		title,
		description,
		baseRefOverride || session.baseRef,
		token,
	);
	return { status: "pr_created", prUrl };
}
