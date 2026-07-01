import type { CompanionSession, CompanionSessionStatus, EffortLevel, RuntimeAgentId } from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

interface CompanionSessionRow {
	id: string;
	workspace_id: string;
	name: string;
	use_worktree: number;
	base_ref: string;
	branch_name: string | null;
	worktree_path: string | null;
	workflow_id: string | null;
	seed_prompt: string;
	agent_id: string;
	model: string | null;
	effort: string | null;
	status: string;
	created_at: number;
	updated_at: number;
}

function sessionFromRow(row: CompanionSessionRow): CompanionSession {
	return {
		id: row.id,
		name: row.name,
		useWorktree: row.use_worktree === 1,
		baseRef: row.base_ref,
		branchName: row.branch_name,
		worktreePath: row.worktree_path,
		workflowId: row.workflow_id,
		seedPrompt: row.seed_prompt,
		agentId: row.agent_id as RuntimeAgentId,
		model: row.model,
		effort: row.effort as EffortLevel | null,
		status: row.status as CompanionSessionStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function listCompanionSessions(workspaceId: string): CompanionSession[] {
	const rows = getDb()
		.prepare("SELECT * FROM companion_sessions WHERE workspace_id = ? ORDER BY created_at DESC")
		.all(workspaceId) as CompanionSessionRow[];
	return rows.map(sessionFromRow);
}

export function getCompanionSession(id: string): CompanionSession | null {
	const row = getDb().prepare("SELECT * FROM companion_sessions WHERE id = ?").get(id) as
		| CompanionSessionRow
		| undefined;
	return row ? sessionFromRow(row) : null;
}

export interface CreateCompanionSessionInput {
	name: string;
	useWorktree: boolean;
	baseRef: string;
	branchName: string | null;
	workflowId: string | null;
	seedPrompt: string;
	agentId: RuntimeAgentId;
	model: string | null;
	effort: EffortLevel | null;
}

export function createCompanionSession(workspaceId: string, input: CreateCompanionSessionInput): CompanionSession {
	const id = `cs_${generateTaskId()}`;
	const now = Date.now();

	getDb()
		.prepare(
			`INSERT INTO companion_sessions
				(id, workspace_id, name, use_worktree, base_ref, branch_name, worktree_path, workflow_id, seed_prompt,
				 agent_id, model, effort, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
		)
		.run(
			id,
			workspaceId,
			input.name,
			input.useWorktree ? 1 : 0,
			input.baseRef,
			input.branchName,
			input.workflowId,
			input.seedPrompt,
			input.agentId,
			input.model,
			input.effort,
			now,
			now,
		);

	const created = getCompanionSession(id);
	if (!created) throw new Error("createCompanionSession: row vanished after insert");
	return created;
}

export function setCompanionSessionWorktreePath(id: string, worktreePath: string | null): void {
	getDb()
		.prepare("UPDATE companion_sessions SET worktree_path = ?, updated_at = ? WHERE id = ?")
		.run(worktreePath, Date.now(), id);
}

export function setCompanionSessionStatus(id: string, status: CompanionSessionStatus): void {
	getDb().prepare("UPDATE companion_sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function deleteCompanionSession(id: string): void {
	getDb().prepare("DELETE FROM companion_sessions WHERE id = ?").run(id);
}

// Resets sessions left "running"/"installing" from an unclean shutdown (crash,
// kill -9 — anything that skipped stopAll()) so they don't show live forever
// with nothing actually behind them. Worktree/branch are left untouched: the
// daemon restarting doesn't remove anything on disk, only the in-memory process
// tracking is gone. Mirrors failStaleRecurringRuns. Returns how many were reset.
export function resetStaleCompanionSessions(workspaceId: string): number {
	const res = getDb()
		.prepare(
			"UPDATE companion_sessions SET status = 'stopped', updated_at = ? WHERE workspace_id = ? AND status IN ('running', 'installing')",
		)
		.run(Date.now(), workspaceId);
	return res.changes;
}
