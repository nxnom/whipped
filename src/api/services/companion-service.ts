import {
	DEFAULT_AGENT_MODEL_CHOICE,
	type CompanionSession,
	type CompanionSessionCreateRequest,
} from "../../core/api-contract.js";
import { resolvePromptText } from "../../core/prompt-resolver.js";
import type { TaskScheduler } from "../../daemon/scheduler.js";
import {
	createCompanionSession,
	deleteCompanionSession,
	getCompanionSession,
	listCompanionSessions,
} from "../../state/companion-sessions-store.js";
import { loadProjectConfig } from "../../state/workspace-state.js";
import { removeWorktreeAsync } from "../../worktree/worktree-manager.js";
import { BadRequestError, NotFoundError } from "../errors/http-errors.js";

export async function listCompanionSessionsEntry(workspaceId: string): Promise<CompanionSession[]> {
	return listCompanionSessions(workspaceId);
}

export function getCompanionSessionEntry(id: string): CompanionSession | null {
	return getCompanionSession(id);
}

export async function createCompanionSessionEntry(
	workspaceId: string,
	repoPath: string,
	req: CompanionSessionCreateRequest,
	scheduler: TaskScheduler,
): Promise<CompanionSession> {
	const useWorktree = req.useWorktree;
	const branchName = req.branchName?.trim() || null;
	if (useWorktree && !branchName) {
		throw BadRequestError("Branch name is required when using an isolated worktree");
	}

	const projectConfig = await loadProjectConfig(workspaceId);
	const workflow = req.workflowId ? projectConfig.workflows.find((w) => w.id === req.workflowId) : undefined;
	const devSlot = workflow?.slots.find((s) => s.type === "dev");
	const seedPrompt = devSlot ? resolvePromptText(devSlot.prompt, repoPath) : "";
	const suggestedPair = devSlot?.pairs[0];

	const model =
		req.model ??
		(suggestedPair
			? { agentId: suggestedPair.binary, model: suggestedPair.model, effort: suggestedPair.effort }
			: DEFAULT_AGENT_MODEL_CHOICE);

	const name = req.name?.trim() || (useWorktree ? branchName! : "Main repo session");

	const session = createCompanionSession(workspaceId, {
		name,
		useWorktree,
		baseRef: req.baseRef,
		branchName: useWorktree ? branchName : null,
		workflowId: workflow?.id ?? null,
		seedPrompt,
		agentId: model.agentId ?? "claude",
		model: model.model ?? null,
		effort: model.effort ?? null,
	});

	await scheduler.startCompanionAgent(session);
	return getCompanionSession(session.id) ?? session;
}

export async function stopCompanionSessionEntry(id: string, scheduler: TaskScheduler | undefined): Promise<void> {
	if (!getCompanionSession(id)) throw NotFoundError("Companion session");
	await scheduler?.stopCompanionAgent(id);
}

// Stops the session (if live), removes its worktree/branch entirely, and
// deletes the session record itself — unlike stop, which leaves both the
// worktree and the row in place so the session can be resumed or merged later.
export async function discardCompanionSessionEntry(
	id: string,
	repoPath: string,
	scheduler: TaskScheduler | undefined,
): Promise<void> {
	const session = getCompanionSession(id);
	if (!session) throw NotFoundError("Companion session");

	await scheduler?.stopCompanionAgent(id);
	if (session.useWorktree && session.worktreePath) {
		await removeWorktreeAsync(id, repoPath, session.branchName ?? undefined);
	}
	deleteCompanionSession(id);
}
