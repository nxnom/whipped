import type { CanvasBlock, CanvasDocument } from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

const RECENT_CANVASES_LIMIT = 20;

interface CompanionCanvasRow {
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

// The wire-level CanvasDocument has no id — it's keyed by version, not a row id.
function canvasFromRow(row: CompanionCanvasRow): CanvasDocument {
	return {
		version: row.version,
		createdAt: row.created_at,
		blocks: safeJsonParse<CanvasBlock[]>(row.blocks_json, []),
	};
}

function nextVersion(sessionId: string): number {
	const row = getDb()
		.prepare("SELECT MAX(version) as max FROM companion_canvases WHERE session_id = ?")
		.get(sessionId) as { max: number | null } | undefined;
	return (row?.max ?? 0) + 1;
}

export function createCompanionCanvas(sessionId: string, workspaceId: string, blocks: CanvasBlock[]): CanvasDocument {
	const id = `cpv_${generateTaskId()}`;
	const version = nextVersion(sessionId);
	const createdAt = Date.now();

	getDb()
		.prepare(
			"INSERT INTO companion_canvases (id, session_id, workspace_id, version, blocks_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, sessionId, workspaceId, version, JSON.stringify(blocks), createdAt);

	return { version, createdAt, blocks };
}

export function listCompanionCanvases(sessionId: string): CanvasDocument[] {
	const rows = getDb()
		.prepare("SELECT * FROM companion_canvases WHERE session_id = ? ORDER BY version DESC LIMIT ?")
		.all(sessionId, RECENT_CANVASES_LIMIT) as CompanionCanvasRow[];
	return rows.map(canvasFromRow);
}

export function deleteCompanionCanvasesForSession(sessionId: string): void {
	getDb().prepare("DELETE FROM companion_canvases WHERE session_id = ?").run(sessionId);
}
