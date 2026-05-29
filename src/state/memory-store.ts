import type {
	MemoryScope,
	MemorySourceType,
	MemoryStatus,
	MemoryType,
	RuntimeMemory,
	RuntimeMemoryOriginAgent,
} from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

// ─── Row mapping ────────────────────────────────────────────────────────────

interface MemoryRow {
	id: string;
	scope: MemoryScope;
	workspace_id: string | null;
	type: MemoryType;
	title: string;
	content: string;
	source_type: MemorySourceType;
	importance: number;
	origin_card_id: string | null;
	origin_agent: string | null;
	status: MemoryStatus;
	created_at: number;
	updated_at: number;
}

function rowToMemory(row: MemoryRow): RuntimeMemory {
	let originAgent: RuntimeMemoryOriginAgent | null = null;
	if (row.origin_agent) {
		try {
			originAgent = JSON.parse(row.origin_agent) as RuntimeMemoryOriginAgent;
		} catch {
			originAgent = null;
		}
	}
	return {
		id: row.id,
		scope: row.scope,
		workspaceId: row.workspace_id,
		type: row.type,
		title: row.title,
		content: row.content,
		sourceType: row.source_type,
		importance: row.importance,
		originCardId: row.origin_card_id,
		originAgent,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// ─── Create / update / delete ─────────────────────────────────────────────────

export interface CreateMemoryInput {
	scope: MemoryScope;
	workspaceId?: string | null; // required when scope === 'project'
	type: MemoryType;
	title: string;
	content: string;
	sourceType: MemorySourceType;
	importance?: number;
	originCardId?: string | null;
	originAgent?: RuntimeMemoryOriginAgent | null;
	status?: MemoryStatus;
}

export function createMemory(input: CreateMemoryInput): RuntimeMemory {
	const db = getDb();
	const id = generateTaskId();
	const now = Date.now();
	const workspaceId = input.scope === "project" ? (input.workspaceId ?? null) : null;
	if (input.scope === "project" && !workspaceId) {
		throw new Error("project-scoped memory requires a workspaceId");
	}
	db.prepare(
		`INSERT INTO memories (
			id, scope, workspace_id, type, title, content, source_type,
			importance, origin_card_id, origin_agent, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		id,
		input.scope,
		workspaceId,
		input.type,
		input.title,
		input.content,
		input.sourceType,
		input.importance ?? 1,
		input.originCardId ?? null,
		input.originAgent ? JSON.stringify(input.originAgent) : null,
		input.status ?? "approved",
		now,
		now,
	);
	return getMemory(id)!;
}

export interface UpdateMemoryInput {
	type?: MemoryType;
	title?: string;
	content?: string;
	importance?: number;
	status?: MemoryStatus;
}

export function updateMemory(id: string, patch: UpdateMemoryInput): RuntimeMemory | null {
	const db = getDb();
	const existing = getMemory(id);
	if (!existing) return null;
	const next = {
		type: patch.type ?? existing.type,
		title: patch.title ?? existing.title,
		content: patch.content ?? existing.content,
		importance: patch.importance ?? existing.importance,
		status: patch.status ?? existing.status,
	};
	db.prepare(
		`UPDATE memories SET type = ?, title = ?, content = ?, importance = ?, status = ?, updated_at = ?
		 WHERE id = ?`,
	).run(next.type, next.title, next.content, next.importance, next.status, Date.now(), id);
	return getMemory(id);
}

export function approveMemory(id: string): RuntimeMemory | null {
	return updateMemory(id, { status: "approved" });
}

// Auto-approve policy by (scope, source_type). Project memory is permissive;
// global memory only auto-approves explicit user signals. Anything else is
// proposed as 'pending' for human review in the Memory inbox.
export function shouldAutoApprove(scope: MemoryScope, sourceType: MemorySourceType): boolean {
	if (sourceType === "user_correction" || sourceType === "explicit_save" || sourceType === "manual_human") {
		return true;
	}
	// task_lesson: auto for project, review for global.
	if (sourceType === "task_lesson") return scope === "project";
	return false;
}

// Agent-facing create: status is decided by the auto-approve policy.
export function proposeMemory(input: CreateMemoryInput): RuntimeMemory {
	const status = shouldAutoApprove(input.scope, input.sourceType) ? "approved" : "pending";
	return createMemory({ ...input, status });
}

// Agent-facing update of an existing memory. The same auto-approve policy as
// create decides whether the edit applies immediately or drops to pending for
// review (based on the existing memory's scope + the agent-supplied sourceType).
// Returns null if the id doesn't exist.
export function proposeMemoryUpdate(
	id: string,
	patch: UpdateMemoryInput,
	sourceType: MemorySourceType,
): RuntimeMemory | null {
	const existing = getMemory(id);
	if (!existing) return null;
	const status: MemoryStatus = shouldAutoApprove(existing.scope, sourceType) ? "approved" : "pending";
	return updateMemory(id, { ...patch, status });
}

export function deleteMemory(id: string): void {
	getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
}

// Remove still-pending proposals that originated from a card (called when a
// card is closed/failed/deleted). Approved memories are kept.
export function deletePendingMemoriesForCard(cardId: string): number {
	const result = getDb()
		.prepare("DELETE FROM memories WHERE origin_card_id = ? AND status = 'pending'")
		.run(cardId);
	return result.changes;
}

// ─── Read / list / search ───────────────────────────────────────────────────

export function getMemory(id: string): RuntimeMemory | null {
	const row = getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
	return row ? rowToMemory(row) : null;
}

export interface ListMemoriesFilter {
	scope?: MemoryScope;
	workspaceId?: string | null;
	status?: MemoryStatus;
}

export function listMemories(filter: ListMemoriesFilter = {}): RuntimeMemory[] {
	const clauses: string[] = [];
	const params: unknown[] = [];
	if (filter.scope) {
		clauses.push("scope = ?");
		params.push(filter.scope);
	}
	if (filter.workspaceId !== undefined) {
		if (filter.workspaceId === null) {
			clauses.push("workspace_id IS NULL");
		} else {
			clauses.push("workspace_id = ?");
			params.push(filter.workspaceId);
		}
	}
	if (filter.status) {
		clauses.push("status = ?");
		params.push(filter.status);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const rows = getDb()
		.prepare(`SELECT * FROM memories ${where} ORDER BY importance DESC, updated_at DESC`)
		.all(...params) as MemoryRow[];
	return rows.map(rowToMemory);
}

// All memories that originated from a specific card (any scope/status), newest first.
export function listMemoriesForCard(cardId: string): RuntimeMemory[] {
	const rows = getDb()
		.prepare("SELECT * FROM memories WHERE origin_card_id = ? ORDER BY created_at DESC")
		.all(cardId) as MemoryRow[];
	return rows.map(rowToMemory);
}

// FTS search scoped to global + an optional project workspace. Only approved
// memories are returned. `query` is matched against title + content.
export function searchMemories(query: string, workspaceId?: string | null, limit = 20): RuntimeMemory[] {
	const trimmed = query.trim();
	if (!trimmed) return [];
	// Quote each token to keep FTS5 happy with arbitrary user input.
	const ftsQuery = trimmed
		.split(/\s+/)
		.map((t) => `"${t.replace(/"/g, '""')}"`)
		.join(" ");

	const scopeClause = workspaceId
		? "(m.scope = 'global' OR (m.scope = 'project' AND m.workspace_id = ?))"
		: "m.scope = 'global'";
	const params: unknown[] = [ftsQuery];
	if (workspaceId) params.push(workspaceId);
	params.push(limit);

	const rows = getDb()
		.prepare(
			`SELECT m.* FROM memories_fts f
			 JOIN memories m ON m.rowid = f.rowid
			 WHERE memories_fts MATCH ? AND m.status = 'approved' AND ${scopeClause}
			 ORDER BY rank
			 LIMIT ?`,
		)
		.all(...params) as MemoryRow[];
	return rows.map(rowToMemory);
}

// ─── Prompt injection ─────────────────────────────────────────────────────────

// Build a markdown block of memory to inject into an agent's system prompt.
// Includes approved project memory (top by importance) and global preferences.
// Returns an empty string when there's nothing to inject. Each memory carries
// its id so the agent can target it with whipped_update_memory.
export function buildMemoryContext(workspaceId: string, projectMemoryLimit = 40): string {
	const sections: string[] = [];

	const fmt = (m: RuntimeMemory) =>
		`- [${m.id}] (${m.type}) **${m.title}** — ${m.content.replace(/\s+/g, " ").trim()}`;

	const projectMem = listMemories({ scope: "project", workspaceId, status: "approved" }).slice(
		0,
		projectMemoryLimit,
	);
	if (projectMem.length > 0) {
		sections.push(`### Project memory\n${projectMem.map(fmt).join("\n")}`);
	}

	const globalMem = listMemories({ scope: "global", status: "approved" });
	if (globalMem.length > 0) {
		sections.push(`### Global preferences\n${globalMem.map(fmt).join("\n")}`);
	}

	if (sections.length === 0) return "";

	return [
		"## Memory",
		"This is whipped's persistent project memory — durable knowledge from past work. Each entry is prefixed with its id. Use `whipped_search_memory` / `whipped_get_memory` to recall more, and `whipped_update_memory` to correct an entry that's now wrong. Treat these as hints, not gospel: if a memory references a file, symbol, or rule, verify it still holds before relying on it.",
		...sections,
	].join("\n\n");
}
