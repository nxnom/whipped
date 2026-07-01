import type { CompanionSavedPlan, PlanBlock } from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

interface CompanionSavedPlanRow {
	id: string;
	workspace_id: string;
	title: string;
	blocks_json: string;
	source_session_id: string | null;
	created_at: number;
	updated_at: number;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function savedPlanFromRow(row: CompanionSavedPlanRow): CompanionSavedPlan {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		title: row.title,
		blocks: safeJsonParse<PlanBlock[]>(row.blocks_json, []),
		sourceSessionId: row.source_session_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function listCompanionSavedPlans(workspaceId: string): CompanionSavedPlan[] {
	const rows = getDb()
		.prepare("SELECT * FROM companion_saved_plans WHERE workspace_id = ? ORDER BY updated_at DESC")
		.all(workspaceId) as CompanionSavedPlanRow[];
	return rows.map(savedPlanFromRow);
}

export function getCompanionSavedPlan(id: string): CompanionSavedPlan | null {
	const row = getDb().prepare("SELECT * FROM companion_saved_plans WHERE id = ?").get(id) as
		| CompanionSavedPlanRow
		| undefined;
	return row ? savedPlanFromRow(row) : null;
}

export function createCompanionSavedPlan(
	workspaceId: string,
	input: { title: string; blocks: PlanBlock[]; sourceSessionId: string | null },
): CompanionSavedPlan {
	const id = `csp_${generateTaskId()}`;
	const now = Date.now();

	getDb()
		.prepare(
			`INSERT INTO companion_saved_plans
				(id, workspace_id, title, blocks_json, source_session_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(id, workspaceId, input.title, JSON.stringify(input.blocks), input.sourceSessionId, now, now);

	const created = getCompanionSavedPlan(id);
	if (!created) throw new Error("createCompanionSavedPlan: row vanished after insert");
	return created;
}

export function updateCompanionSavedPlan(
	id: string,
	input: { title: string; blocks: PlanBlock[] },
): CompanionSavedPlan | null {
	getDb()
		.prepare("UPDATE companion_saved_plans SET title = ?, blocks_json = ?, updated_at = ? WHERE id = ?")
		.run(input.title, JSON.stringify(input.blocks), Date.now(), id);
	return getCompanionSavedPlan(id);
}

export function deleteCompanionSavedPlan(id: string): void {
	getDb().prepare("DELETE FROM companion_saved_plans WHERE id = ?").run(id);
}

// Fallback lookup for sessions with no companion_sessions row to store a link
// on (e.g. the assistant agent's synthetic per-workspace session id) — finds
// the most recent saved plan this exact session id already produced, so a
// repeat save updates it instead of creating a duplicate.
export function findCompanionSavedPlanBySourceSession(sessionId: string): CompanionSavedPlan | null {
	const row = getDb()
		.prepare("SELECT * FROM companion_saved_plans WHERE source_session_id = ? ORDER BY updated_at DESC LIMIT 1")
		.get(sessionId) as CompanionSavedPlanRow | undefined;
	return row ? savedPlanFromRow(row) : null;
}
