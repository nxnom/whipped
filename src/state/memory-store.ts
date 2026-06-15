import type {
	MemoryScope,
	MemorySourceType,
	MemoryStatus,
	MemoryType,
	RuntimeMemory,
	RuntimeMemoryOriginAgent,
} from "../core/api-contract.js";
import { normalizeTag } from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

// ─── Row mapping ────────────────────────────────────────────────────────────

interface MemoryRow {
	id: string;
	scope: MemoryScope;
	workspace_id: string | null;
	origin_workspace_id: string | null;
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
		originWorkspaceId: row.origin_workspace_id,
		type: row.type,
		title: row.title,
		content: row.content,
		sourceType: row.source_type,
		importance: row.importance,
		tags: [],
		boundWorkspaceIds: [],
		originCardId: row.origin_card_id,
		originAgent,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function groupValues(rows: { key: string; value: string }[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const r of rows) {
		const arr = map.get(r.key);
		if (arr) arr.push(r.value);
		else map.set(r.key, [r.value]);
	}
	return map;
}

// Hydrate tags + explicit bindings onto a set of memories in two batched queries
// (avoids N+1 when listing).
function hydrate(memories: RuntimeMemory[]): RuntimeMemory[] {
	if (memories.length === 0) return memories;
	const db = getDb();
	const ids = memories.map((m) => m.id);
	const placeholders = ids.map(() => "?").join(",");
	const tagRows = db
		.prepare(`SELECT memory_id AS key, tag AS value FROM memory_tags WHERE memory_id IN (${placeholders})`)
		.all(...ids) as { key: string; value: string }[];
	const bindRows = db
		.prepare(
			`SELECT memory_id AS key, workspace_id AS value FROM memory_workspace_bindings WHERE memory_id IN (${placeholders})`,
		)
		.all(...ids) as { key: string; value: string }[];
	const tagsByMem = groupValues(tagRows);
	const bindsByMem = groupValues(bindRows);
	for (const m of memories) {
		m.tags = tagsByMem.get(m.id) ?? [];
		m.boundWorkspaceIds = bindsByMem.get(m.id) ?? [];
	}
	return memories;
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

function ensureTags(tags: string[]): string[] {
	const db = getDb();
	const normalized = [...new Set(tags.map(normalizeTag).filter(Boolean))];
	const insert = db.prepare("INSERT OR IGNORE INTO tags (name) VALUES (?)");
	for (const name of normalized) insert.run(name);
	return normalized;
}

export function listTags(): string[] {
	const rows = getDb().prepare("SELECT name FROM tags ORDER BY name").all() as { name: string }[];
	return rows.map((r) => r.name);
}

export function setMemoryTags(memoryId: string, tags: string[]): void {
	const db = getDb();
	const normalized = ensureTags(tags);
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
		const insert = db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
		for (const tag of normalized) insert.run(memoryId, tag);
	});
	tx();
}

export function setMemoryBindings(memoryId: string, workspaceIds: string[]): void {
	const db = getDb();
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM memory_workspace_bindings WHERE memory_id = ?").run(memoryId);
		const insert = db.prepare(
			"INSERT OR IGNORE INTO memory_workspace_bindings (memory_id, workspace_id) VALUES (?, ?)",
		);
		for (const ws of [...new Set(workspaceIds)]) insert.run(memoryId, ws);
	});
	tx();
}

export function getWorkspaceTags(workspaceId: string): string[] {
	const rows = getDb()
		.prepare("SELECT tag FROM workspace_tags WHERE workspace_id = ? ORDER BY tag")
		.all(workspaceId) as { tag: string }[];
	return rows.map((r) => r.tag);
}

export function setWorkspaceTags(workspaceId: string, tags: string[]): void {
	const db = getDb();
	const normalized = ensureTags(tags);
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM workspace_tags WHERE workspace_id = ?").run(workspaceId);
		const insert = db.prepare("INSERT OR IGNORE INTO workspace_tags (workspace_id, tag) VALUES (?, ?)");
		for (const tag of normalized) insert.run(workspaceId, tag);
	});
	tx();
}

// ─── Create / update / delete ─────────────────────────────────────────────────

export interface CreateMemoryInput {
	scope: MemoryScope;
	workspaceId?: string | null; // required when scope === 'project'
	originWorkspaceId?: string | null; // workspace that produced it (origin safety net)
	type: MemoryType;
	title: string;
	content: string;
	sourceType: MemorySourceType;
	importance?: number;
	tags?: string[]; // required (≥1) when scope === 'global'
	boundWorkspaceIds?: string[]; // explicit project bindings (human-set)
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
	const tags = [...new Set((input.tags ?? []).map(normalizeTag).filter(Boolean))];
	if (input.scope === "global" && tags.length === 0) {
		throw new Error("global-scoped memory requires at least one tag");
	}
	const originWorkspaceId = input.originWorkspaceId ?? workspaceId;
	// origin_card_id is a FK (ON DELETE SET NULL). Drop a stale/unknown card id
	// rather than letting the insert fail the foreign-key constraint.
	const originCardId =
		input.originCardId && db.prepare("SELECT 1 FROM cards WHERE id = ?").get(input.originCardId)
			? input.originCardId
			: null;
	const tx = db.transaction(() => {
		db.prepare(
			`INSERT INTO memories (
				id, scope, workspace_id, origin_workspace_id, type, title, content, source_type,
				importance, origin_card_id, origin_agent, status, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			input.scope,
			workspaceId,
			originWorkspaceId,
			input.type,
			input.title,
			input.content,
			input.sourceType,
			input.importance ?? 1,
			originCardId,
			input.originAgent ? JSON.stringify(input.originAgent) : null,
			input.status ?? "approved",
			now,
			now,
		);
		if (tags.length > 0) setMemoryTags(id, tags);
		if (input.boundWorkspaceIds && input.boundWorkspaceIds.length > 0) setMemoryBindings(id, input.boundWorkspaceIds);
	});
	tx();
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
	const result = getDb().prepare("DELETE FROM memories WHERE origin_card_id = ? AND status = 'pending'").run(cardId);
	return result.changes;
}

// ─── Read / list / search ───────────────────────────────────────────────────

export function getMemory(id: string): RuntimeMemory | null {
	const row = getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | undefined;
	if (!row) return null;
	return hydrate([rowToMemory(row)])[0] ?? null;
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
	return hydrate(rows.map(rowToMemory));
}

// All memories that originated from a specific card (any scope/status), newest first.
export function listMemoriesForCard(cardId: string): RuntimeMemory[] {
	const rows = getDb()
		.prepare("SELECT * FROM memories WHERE origin_card_id = ? ORDER BY created_at DESC")
		.all(cardId) as MemoryRow[];
	return hydrate(rows.map(rowToMemory));
}

// Visibility predicate for a global memory reaching a workspace: shared tag,
// origin workspace, or explicit binding. Project memory routes by workspace_id.
const VISIBLE_WHERE = `(
	(m.scope = 'project' AND m.workspace_id = @ws)
	OR (m.scope = 'global' AND (
		m.origin_workspace_id = @ws
		OR EXISTS (SELECT 1 FROM memory_tags mt JOIN workspace_tags wt
		           ON wt.tag = mt.tag
		           WHERE mt.memory_id = m.id AND wt.workspace_id = @ws)
		OR EXISTS (SELECT 1 FROM memory_workspace_bindings b
		           WHERE b.memory_id = m.id AND b.workspace_id = @ws)
	))
)`;

// Approved memories actually visible to a workspace (project + routed global),
// ordered by importance.
export function listVisibleMemories(workspaceId: string): RuntimeMemory[] {
	const rows = getDb()
		.prepare(
			`SELECT m.* FROM memories m
			 WHERE m.status = 'approved' AND ${VISIBLE_WHERE}
			 ORDER BY m.importance DESC, m.updated_at DESC`,
		)
		.all({ ws: workspaceId }) as MemoryRow[];
	return hydrate(rows.map(rowToMemory));
}

// FTS search. With a workspaceId, results are scoped to what's visible to that
// workspace; without one, all approved memories are searched (admin/debug).
// `query` is matched against title + content.
export function searchMemories(query: string, workspaceId?: string | null, limit = 20): RuntimeMemory[] {
	const trimmed = query.trim();
	if (!trimmed) return [];
	// Quote each token to keep FTS5 happy with arbitrary user input.
	const ftsQuery = trimmed
		.split(/\s+/)
		.map((t) => `"${t.replace(/"/g, '""')}"`)
		.join(" ");

	if (!workspaceId) {
		const rows = getDb()
			.prepare(
				`SELECT m.* FROM memories_fts f
				 JOIN memories m ON m.rowid = f.rowid
				 WHERE memories_fts MATCH @q AND m.status = 'approved'
				 ORDER BY rank LIMIT @limit`,
			)
			.all({ q: ftsQuery, limit }) as MemoryRow[];
		return hydrate(rows.map(rowToMemory));
	}

	const rows = getDb()
		.prepare(
			`SELECT m.* FROM memories_fts f
			 JOIN memories m ON m.rowid = f.rowid
			 WHERE memories_fts MATCH @q AND m.status = 'approved' AND ${VISIBLE_WHERE}
			 ORDER BY rank LIMIT @limit`,
		)
		.all({ q: ftsQuery, ws: workspaceId, limit }) as MemoryRow[];
	return hydrate(rows.map(rowToMemory));
}

// ─── Prompt injection ─────────────────────────────────────────────────────────

// Build a markdown block of memory to inject into an agent's system prompt.
// Includes approved project memory and global memory routed to this workspace
// (top by importance). Returns an empty string when there's nothing to inject.
// Each memory carries its id so the agent can target it with whipped_update_memory.
export function buildMemoryContext(workspaceId: string, memoryLimit = 40, opts?: { readOnly?: boolean }): string {
	const sections: string[] = [];

	const fmt = (m: RuntimeMemory) => {
		const tagSuffix = m.tags.length > 0 ? ` _(tags: ${m.tags.join(", ")})_` : "";
		return `- [${m.id}] (${m.type}) **${m.title}** — ${m.content.replace(/\s+/g, " ").trim()}${tagSuffix}`;
	};

	const visible = listVisibleMemories(workspaceId).slice(0, memoryLimit);
	const projectMem = visible.filter((m) => m.scope === "project");
	const globalMem = visible.filter((m) => m.scope === "global");

	if (projectMem.length > 0) {
		sections.push(`### Project memory\n${projectMem.map(fmt).join("\n")}`);
	}
	if (globalMem.length > 0) {
		sections.push(`### Global memory (routed to this project by tag)\n${globalMem.map(fmt).join("\n")}`);
	}

	if (sections.length === 0) return "";

	// Observers (read-only) can neither save nor update memory, so omit the
	// update-tool hint and the tag-reuse guidance (which only matters when saving).
	const readOnly = opts?.readOnly ?? false;
	const knownTags = listTags();
	const tagLine =
		!readOnly && knownTags.length > 0
			? `\n\nExisting tags (reuse before inventing new ones): ${knownTags.join(", ")}.`
			: "";
	const recallLine = readOnly
		? "Use `whipped_search_memory` / `whipped_get_memory` to recall more."
		: "Use `whipped_search_memory` / `whipped_get_memory` to recall more, and `whipped_update_memory` to correct an entry that's now wrong.";

	return [
		"## Memory",
		`This is whipped's persistent project memory — durable knowledge from past work. Each entry is prefixed with its id. ${recallLine} Treat these as hints, not gospel: if a memory references a file, symbol, or rule, verify it still holds before relying on it.${tagLine}`,
		...sections,
	].join("\n\n");
}
