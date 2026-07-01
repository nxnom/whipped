import type { PlanBlock, PlanDocument } from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

const RECENT_PLANS_LIMIT = 20;

interface CompanionPlanRow {
	id: string;
	session_id: string;
	workspace_id: string;
	version: number;
	blocks_json: string;
	created_at: number;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

// The wire-level PlanDocument has no id — it's keyed by version, not a row id.
function planFromRow(row: CompanionPlanRow): PlanDocument {
	return {
		version: row.version,
		createdAt: row.created_at,
		blocks: safeJsonParse<PlanBlock[]>(row.blocks_json, []),
	};
}

function nextVersion(sessionId: string): number {
	const row = getDb().prepare("SELECT MAX(version) as max FROM companion_plans WHERE session_id = ?").get(sessionId) as
		| { max: number | null }
		| undefined;
	return (row?.max ?? 0) + 1;
}

export function createCompanionPlan(sessionId: string, workspaceId: string, blocks: PlanBlock[]): PlanDocument {
	const id = `cpv_${generateTaskId()}`;
	const version = nextVersion(sessionId);
	const createdAt = Date.now();

	getDb()
		.prepare(
			"INSERT INTO companion_plans (id, session_id, workspace_id, version, blocks_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, sessionId, workspaceId, version, JSON.stringify(blocks), createdAt);

	return { version, createdAt, blocks };
}

export function listCompanionPlans(sessionId: string): PlanDocument[] {
	const rows = getDb()
		.prepare("SELECT * FROM companion_plans WHERE session_id = ? ORDER BY version DESC LIMIT ?")
		.all(sessionId, RECENT_PLANS_LIMIT) as CompanionPlanRow[];
	return rows.map(planFromRow);
}
