import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { ATTACHMENTS_DIR, WORKSPACES_DIR } from "../config/runtime-config.js";
import {
	BOARD_COLUMNS,
	type RuntimeActivityEntry,
	type RuntimeBoardCard,
	type RuntimeBoardColumnId,
	type RuntimeBoardData,
	type RuntimeProjectConfig,
	type RuntimeReviewComment,
	type RuntimeTaskSessionState,
	type RuntimeTerminalSessionEntry,
	type RuntimeWorkspaceStateResponse,
	type RuntimeWorkspaceStateSaveRequest,
	highestWorkflowLevel,
	resolveWorkflowForCard,
	runtimeProjectConfigSchema,
	snapshotModelConfig,
} from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";
import { decrypt, encrypt } from "./secrets-crypto.js";

// ─── Workspace paths ──────────────────────────────────────────────────────────

function workspaceDirPath(workspaceId: string): string {
	return join(WORKSPACES_DIR, workspaceId);
}

function bufferFilePath(workspaceId: string, streamId: string): string {
	// Sanitise streamId for use as a filename
	const safe = streamId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(workspaceDirPath(workspaceId), "buffers", `${safe}.ansi`);
}

// ─── Card row helpers ─────────────────────────────────────────────────────────

interface CardRow {
	id: string;
	workspace_id: string;
	description: string;
	description_attachments_json: string;
	column_id: RuntimeBoardColumnId;
	column_position: number;
	type: "task" | "story" | "subtask";
	ready_for_dev: number;
	agent_id: RuntimeBoardCard["agentId"] | null;
	priority: RuntimeBoardCard["priority"] | null;
	auto_fix_attempts: number;
	base_ref: string;
	workflow_id: string | null;
	github_issue_url: string | null;
	pr_json: string | null;
	github_comment_ids_json: string;
	worktree_path: string | null;
	branch_name: string | null;
	depends_on_id: string | null;
	slack_message_ts: string | null;
	slack_channel_id: string | null;
	plan: string | null;
	active_level: string;
	model_config_json: string | null;
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

function cardFromRow(row: CardRow, children: ReturnType<typeof loadCardChildren>): RuntimeBoardCard {
	const pr = row.pr_json ? safeJsonParse(row.pr_json, undefined as RuntimeBoardCard["pr"]) : undefined;
	const card: RuntimeBoardCard = {
		id: row.id,
		description: row.description,
		descriptionAttachments: safeJsonParse(row.description_attachments_json, []),
		columnId: row.column_id,
		type: row.type,
		readyForDev: row.ready_for_dev === 1,
		waitsFor: children.waitsFor,
		subtaskIds: children.subtaskIds,
		autoFixAttempts: row.auto_fix_attempts,
		activeLevel: (row.active_level as RuntimeBoardCard["activeLevel"]) ?? "medium",
		baseRef: row.base_ref,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		githubCommentIds: safeJsonParse(row.github_comment_ids_json, []),
		reviewComments: children.reviewComments,
		activityLog: children.activityLog,
		terminalSessions: children.terminalSessions,
	};
	if (row.agent_id) card.agentId = row.agent_id;
	if (row.priority) card.priority = row.priority;
	if (row.workflow_id) card.workflowId = row.workflow_id;
	if (row.github_issue_url) card.githubIssueUrl = row.github_issue_url;
	if (pr) card.pr = pr;
	if (row.worktree_path) card.worktreePath = row.worktree_path;
	if (row.branch_name) card.branchName = row.branch_name;
	if (row.depends_on_id) card.dependsOn = row.depends_on_id;
	if (row.slack_message_ts) card.slackMessageTs = row.slack_message_ts;
	if (row.slack_channel_id) card.slackChannelId = row.slack_channel_id;
	if (row.plan) card.plan = row.plan;
	if (row.model_config_json) {
		card.modelConfig = safeJsonParse(row.model_config_json, undefined as RuntimeBoardCard["modelConfig"]);
	}
	return card;
}

function loadCardChildren(
	db: Database.Database,
	cardId: string,
): {
	waitsFor: string[];
	subtaskIds: string[];
	activityLog: RuntimeActivityEntry[];
	reviewComments: RuntimeReviewComment[];
	terminalSessions: RuntimeTerminalSessionEntry[];
} {
	const waitsFor = (
		db.prepare("SELECT waits_for_id FROM card_waits_for WHERE card_id = ?").all(cardId) as Array<{
			waits_for_id: string;
		}>
	).map((r) => r.waits_for_id);

	const subtaskIds = (
		db.prepare("SELECT subtask_id FROM card_subtasks WHERE story_id = ?").all(cardId) as Array<{
			subtask_id: string;
		}>
	).map((r) => r.subtask_id);

	const activityLog = (
		db
			.prepare("SELECT timestamp, message FROM activity_log WHERE card_id = ? ORDER BY timestamp, id")
			.all(cardId) as Array<{ timestamp: number; message: string }>
	).map((r) => ({ timestamp: r.timestamp, message: r.message }));

	const reviewRows = db
		.prepare(
			"SELECT comment_id, created_at, type, actor_type, actor_id, actor_source, status, stream_id, summary, issues_json, attachments_json, metadata_json FROM review_comments WHERE card_id = ? ORDER BY created_at",
		)
		.all(cardId) as Array<{
		comment_id: string;
		created_at: number;
		type: string;
		actor_type: "ai" | "human" | "external";
		actor_id: string;
		actor_source: string | null;
		status: "pass" | "fail" | "warning" | "skipped" | null;
		stream_id: string | null;
		summary: string;
		issues_json: string;
		attachments_json: string;
		metadata_json: string;
	}>;
	const reviewComments: RuntimeReviewComment[] = reviewRows.map((r) => {
		const comment: RuntimeReviewComment = {
			id: r.comment_id,
			type: r.type,
			actor: {
				type: r.actor_type,
				id: r.actor_id,
				...(r.actor_source ? { source: r.actor_source } : {}),
			},
			createdAt: r.created_at,
			summary: r.summary,
		};
		if (r.status) comment.status = r.status;
		if (r.stream_id) comment.streamId = r.stream_id;
		const issues = safeJsonParse(r.issues_json, [] as RuntimeReviewComment["issues"]);
		if (issues && issues.length > 0) comment.issues = issues;
		const attachments = safeJsonParse(r.attachments_json, [] as RuntimeReviewComment["attachments"]);
		if (attachments && attachments.length > 0) comment.attachments = attachments;
		const metadata = safeJsonParse(r.metadata_json, {} as Record<string, unknown>);
		if (metadata && Object.keys(metadata).length > 0) comment.metadata = metadata;
		return comment;
	});

	const sessionRows = db
		.prepare(
			"SELECT stream_id, type, started_at, ended_at, agent_id, state FROM terminal_sessions WHERE card_id = ? ORDER BY started_at",
		)
		.all(cardId) as Array<{
		stream_id: string;
		type: string;
		started_at: number;
		ended_at: number | null;
		agent_id: RuntimeTerminalSessionEntry["agentId"] | null;
		state: RuntimeTaskSessionState | null;
	}>;
	const terminalSessions: RuntimeTerminalSessionEntry[] = sessionRows.map((r) => {
		const entry: RuntimeTerminalSessionEntry = {
			streamId: r.stream_id,
			type: r.type,
			startedAt: r.started_at,
		};
		if (r.ended_at != null) entry.endedAt = r.ended_at;
		if (r.agent_id) entry.agentId = r.agent_id;
		if (r.state) entry.state = r.state;
		return entry;
	});

	return { waitsFor, subtaskIds, activityLog, reviewComments, terminalSessions };
}

function upsertCardRow(
	db: Database.Database,
	workspaceId: string,
	card: RuntimeBoardCard,
	columnPosition: number,
): void {
	db.prepare(
		`INSERT INTO cards (
			id, workspace_id, description, description_attachments_json,
			column_id, column_position, type, ready_for_dev,
			agent_id, priority, auto_fix_attempts, base_ref, workflow_id,
			github_issue_url, pr_json, github_comment_ids_json,
			worktree_path, branch_name, depends_on_id,
			slack_message_ts, slack_channel_id,
			plan, active_level, model_config_json, created_at, updated_at
		) VALUES (
			?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?,
			?, ?,
			?, ?, ?, ?, ?
		) ON CONFLICT(id) DO UPDATE SET
			description = excluded.description,
			description_attachments_json = excluded.description_attachments_json,
			column_id = excluded.column_id,
			column_position = excluded.column_position,
			type = excluded.type,
			ready_for_dev = excluded.ready_for_dev,
			agent_id = excluded.agent_id,
			priority = excluded.priority,
			auto_fix_attempts = excluded.auto_fix_attempts,
			base_ref = excluded.base_ref,
			workflow_id = excluded.workflow_id,
			github_issue_url = excluded.github_issue_url,
			pr_json = excluded.pr_json,
			github_comment_ids_json = excluded.github_comment_ids_json,
			worktree_path = excluded.worktree_path,
			branch_name = excluded.branch_name,
			depends_on_id = excluded.depends_on_id,
			slack_message_ts = excluded.slack_message_ts,
			slack_channel_id = excluded.slack_channel_id,
			plan = excluded.plan,
			active_level = excluded.active_level,
			model_config_json = excluded.model_config_json,
			updated_at = excluded.updated_at`,
	).run(
		card.id,
		workspaceId,
		card.description,
		JSON.stringify(card.descriptionAttachments ?? []),
		card.columnId,
		columnPosition,
		card.type,
		card.readyForDev ? 1 : 0,
		card.agentId ?? null,
		card.priority ?? null,
		card.autoFixAttempts,
		card.baseRef,
		card.workflowId ?? null,
		card.githubIssueUrl ?? null,
		card.pr ? JSON.stringify(card.pr) : null,
		JSON.stringify(card.githubCommentIds ?? []),
		card.worktreePath ?? null,
		card.branchName ?? null,
		card.dependsOn ?? null,
		card.slackMessageTs ?? null,
		card.slackChannelId ?? null,
		card.plan ?? null,
		card.activeLevel ?? "medium",
		card.modelConfig ? JSON.stringify(card.modelConfig) : null,
		card.createdAt,
		card.updatedAt,
	);
}

// Insert a relation row only if the target card exists, so stale references in
// the input array (e.g. a card that was deleted) don't trip the FK and roll back
// the whole save. The relation is meaningless without the target.
const INSERT_CARD_WAITS_FOR_IF_EXISTS = `
	INSERT INTO card_waits_for (card_id, waits_for_id)
	SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cards WHERE id = ?) AND ? != ?
`;

const INSERT_CARD_SUBTASK_IF_EXISTS = `
	INSERT INTO card_subtasks (story_id, subtask_id)
	SELECT ?, ? WHERE EXISTS (SELECT 1 FROM cards WHERE id = ?) AND ? != ?
`;

function replaceCardWaitsFor(db: Database.Database, cardId: string, waitsFor: string[]): void {
	db.prepare("DELETE FROM card_waits_for WHERE card_id = ?").run(cardId);
	const insert = db.prepare(INSERT_CARD_WAITS_FOR_IF_EXISTS);
	for (const targetId of waitsFor) insert.run(cardId, targetId, targetId, cardId, targetId);
}

function replaceCardSubtasks(db: Database.Database, storyId: string, subtaskIds: string[]): void {
	db.prepare("DELETE FROM card_subtasks WHERE story_id = ?").run(storyId);
	const insert = db.prepare(INSERT_CARD_SUBTASK_IF_EXISTS);
	for (const subtaskId of subtaskIds) insert.run(storyId, subtaskId, subtaskId, storyId, subtaskId);
}

function replaceCardChildren(db: Database.Database, card: RuntimeBoardCard): void {
	replaceCardWaitsFor(db, card.id, card.waitsFor ?? []);
	replaceCardSubtasks(db, card.id, card.subtaskIds ?? []);

	db.prepare("DELETE FROM activity_log WHERE card_id = ?").run(card.id);
	const insertActivity = db.prepare("INSERT INTO activity_log (card_id, timestamp, message) VALUES (?, ?, ?)");
	for (const entry of card.activityLog ?? []) insertActivity.run(card.id, entry.timestamp, entry.message);

	db.prepare("DELETE FROM review_comments WHERE card_id = ?").run(card.id);
	const insertReview = db.prepare(
		`INSERT INTO review_comments (
			comment_id, card_id, created_at, type, actor_type, actor_id, actor_source,
			status, stream_id, summary, issues_json, attachments_json, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const c of card.reviewComments ?? []) {
		insertReview.run(
			c.id,
			card.id,
			c.createdAt,
			c.type,
			c.actor.type,
			c.actor.id,
			c.actor.source ?? null,
			c.status ?? null,
			c.streamId ?? null,
			c.summary,
			JSON.stringify(c.issues ?? []),
			JSON.stringify(c.attachments ?? []),
			JSON.stringify(c.metadata ?? {}),
		);
	}

	db.prepare("DELETE FROM terminal_sessions WHERE card_id = ?").run(card.id);
	const insertSession = db.prepare(
		`INSERT INTO terminal_sessions (card_id, stream_id, type, started_at, ended_at, agent_id, state)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const s of card.terminalSessions ?? []) {
		insertSession.run(card.id, s.streamId, s.type, s.startedAt, s.endedAt ?? null, s.agentId ?? null, s.state ?? null);
	}
}

function bumpBoardRevision(db: Database.Database, workspaceId: string): number {
	const row = db
		.prepare("UPDATE workspaces SET board_revision = board_revision + 1 WHERE id = ? RETURNING board_revision")
		.get(workspaceId) as { board_revision: number } | undefined;
	return row?.board_revision ?? 0;
}

// ─── Load / save ──────────────────────────────────────────────────────────────

function loadBoardInternal(workspaceId: string): RuntimeBoardData {
	const db = getDb();
	const cardRows = db
		.prepare("SELECT * FROM cards WHERE workspace_id = ? ORDER BY column_id, column_position")
		.all(workspaceId) as CardRow[];

	const taskIdsByColumn: Record<RuntimeBoardColumnId, string[]> = {
		todo: [],
		in_progress: [],
		reopened: [],
		ready_for_review: [],
		blocked: [],
		done: [],
	};

	const cards: Record<string, RuntimeBoardCard> = {};
	for (const row of cardRows) {
		const card = cardFromRow(row, loadCardChildren(db, row.id));
		cards[card.id] = card;
		taskIdsByColumn[row.column_id].push(row.id);
	}

	const columns = BOARD_COLUMNS.map((col) => ({
		id: col.id,
		title: col.title,
		taskIds: taskIdsByColumn[col.id],
	}));

	return { columns, cards };
}

function saveBoardInternal(workspaceId: string, board: RuntimeBoardData): void {
	const db = getDb();

	// depends_on_id is a self-referential FK; cards are upserted in arbitrary order
	// so a child may be written before its parent. Defer FK checks to commit, by
	// which point every card row exists.
	db.pragma("defer_foreign_keys = ON");

	// Compute (cardId → position) from the columns' taskIds ordering.
	const positionFor = new Map<string, { columnId: RuntimeBoardColumnId; position: number }>();
	for (const col of board.columns) {
		col.taskIds.forEach((cardId, idx) => {
			positionFor.set(cardId, { columnId: col.id, position: idx });
		});
	}

	// Delete cards not in request (CASCADE handles children).
	const existing = db.prepare("SELECT id FROM cards WHERE workspace_id = ?").all(workspaceId) as Array<{
		id: string;
	}>;
	const requestIds = new Set(Object.keys(board.cards));
	const toDelete = existing.filter((r) => !requestIds.has(r.id)).map((r) => r.id);
	if (toDelete.length > 0) {
		const placeholders = toDelete.map(() => "?").join(",");
		db.prepare(`DELETE FROM cards WHERE id IN (${placeholders})`).run(...toDelete);
	}

	for (const card of Object.values(board.cards)) {
		// Trust columnId on the card but use position derived from the column ordering.
		// If the card was missing from any column's taskIds (shouldn't happen) fall back to 0.
		const pos = positionFor.get(card.id);
		const column = pos?.columnId ?? card.columnId;
		const position = pos?.position ?? 0;
		// Ensure the card row's column_id matches the column it appears in, and drop a
		// dependsOn pointing at a card that's not on the board (would fail the FK at commit).
		const sanitizedDependsOn = card.dependsOn && board.cards[card.dependsOn] ? card.dependsOn : undefined;
		const cardForRow: RuntimeBoardCard =
			column === card.columnId && sanitizedDependsOn === card.dependsOn
				? card
				: { ...card, columnId: column, dependsOn: sanitizedDependsOn };
		upsertCardRow(db, workspaceId, cardForRow, position);
		replaceCardChildren(db, cardForRow);
	}
}

export async function loadBoard(workspaceId: string): Promise<RuntimeBoardData> {
	return loadBoardInternal(workspaceId);
}

// Project config is split across multiple SQLite tables:
//   workflows[]          → workflows
//   secrets[]            → workspace_secrets
//   github / jira        → workspace_integrations rows
//   everything else      → workspaces.settings_json
// On load we re-assemble the full RuntimeProjectConfig.

function loadProjectConfigInternal(workspaceId: string): RuntimeProjectConfig {
	const db = getDb();

	const wsRow = db.prepare("SELECT settings_json FROM workspaces WHERE id = ?").get(workspaceId) as
		| { settings_json: string }
		| undefined;
	if (!wsRow) return runtimeProjectConfigSchema.parse({});

	let settings: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(wsRow.settings_json);
		if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
	} catch {
		// fall through with empty
	}

	const workflowRows = db
		.prepare("SELECT id, name, is_default, for_story, slots_json FROM workflows WHERE workspace_id = ?")
		.all(workspaceId) as Array<{
		id: string;
		name: string;
		is_default: number;
		for_story: number;
		slots_json: string;
	}>;
	const workflows = workflowRows.map((row) => {
		let slots: unknown = [];
		try {
			slots = JSON.parse(row.slots_json);
		} catch {
			slots = [];
		}
		return {
			id: row.id,
			name: row.name,
			isDefault: row.is_default === 1,
			forStory: row.for_story === 1,
			slots,
		};
	});

	const secretRows = db
		.prepare("SELECT key, value FROM workspace_secrets WHERE workspace_id = ?")
		.all(workspaceId) as Array<{ key: string; value: string }>;
	const secrets = secretRows.map((r) => ({ key: r.key, value: decrypt(r.value) }));

	const integrationRows = db
		.prepare("SELECT type, config_json FROM workspace_integrations WHERE workspace_id = ? AND enabled = 1")
		.all(workspaceId) as Array<{ type: string; config_json: string }>;
	let github: unknown;
	for (const row of integrationRows) {
		try {
			const cfg = JSON.parse(decrypt(row.config_json));
			if (row.type === "github") github = cfg;
		} catch {
			// skip corrupt row
		}
	}

	const merged: Record<string, unknown> = {
		...settings,
		workflows,
		secrets,
	};
	if (github) merged.github = github;

	// Migrate legacy autonomousModeEnabled + autoPR booleans → deliveryMode enum.
	// Polling is now always on, so autonomousModeEnabled is dropped; autoPR maps to "pr".
	if (merged.deliveryMode === undefined) {
		merged.deliveryMode = merged.autoPR === true ? "pr" : "off";
	}

	const parsed = runtimeProjectConfigSchema.safeParse(merged);
	return parsed.success ? parsed.data : runtimeProjectConfigSchema.parse({});
}

function saveProjectConfigInternal(workspaceId: string, config: RuntimeProjectConfig): void {
	const db = getDb();
	const now = Date.now();

	const { workflows, secrets, github, ...rest } = config;

	db.prepare("UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?").run(
		JSON.stringify(rest),
		now,
		workspaceId,
	);

	// Dedup workflows by id (PK collision) and by name (UNIQUE collision);
	// last entry in the input array wins. Saves the user from a constraint
	// error if the array somehow has duplicates.
	const workflowsById = new Map<string, (typeof workflows)[number]>();
	for (const wf of workflows) workflowsById.set(wf.id, wf);
	const workflowsByName = new Map<string, (typeof workflows)[number]>();
	for (const wf of workflowsById.values()) workflowsByName.set(wf.name, wf);

	db.prepare("DELETE FROM workflows WHERE workspace_id = ?").run(workspaceId);
	const insertWf = db.prepare(
		"INSERT INTO workflows (id, workspace_id, name, is_default, for_story, slots_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	for (const wf of workflowsByName.values()) {
		insertWf.run(
			wf.id,
			workspaceId,
			wf.name,
			wf.isDefault ? 1 : 0,
			wf.forStory ? 1 : 0,
			JSON.stringify(wf.slots),
			now,
			now,
		);
	}

	// Dedup secrets by key; last entry wins.
	const secretsByKey = new Map<string, (typeof secrets)[number]>();
	for (const s of secrets) secretsByKey.set(s.key, s);

	db.prepare("DELETE FROM workspace_secrets WHERE workspace_id = ?").run(workspaceId);
	const insertSec = db.prepare("INSERT INTO workspace_secrets (workspace_id, key, value) VALUES (?, ?, ?)");
	for (const s of secretsByKey.values()) {
		insertSec.run(workspaceId, s.key, encrypt(s.value));
	}

	db.prepare("DELETE FROM workspace_integrations WHERE workspace_id = ?").run(workspaceId);
	const insertInt = db.prepare(
		"INSERT INTO workspace_integrations (workspace_id, type, enabled, config_json, updated_at) VALUES (?, ?, 1, ?, ?)",
	);
	if (github) insertInt.run(workspaceId, "github", encrypt(JSON.stringify(github)), now);
}

export async function loadProjectConfig(workspaceId: string): Promise<RuntimeProjectConfig> {
	return loadProjectConfigInternal(workspaceId);
}

export async function saveProjectConfig(workspaceId: string, config: RuntimeProjectConfig): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => saveProjectConfigInternal(workspaceId, config));
	tx();
}

// Atomic read-modify-write inside a SQLite transaction.
export async function updateProjectConfig(
	workspaceId: string,
	mutator: (config: RuntimeProjectConfig) => RuntimeProjectConfig,
): Promise<RuntimeProjectConfig> {
	const db = getDb();
	const tx = db.transaction(() => {
		const current = loadProjectConfigInternal(workspaceId);
		const next = mutator(current);
		saveProjectConfigInternal(workspaceId, next);
		return next;
	});
	return tx();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface WorkspaceContext {
	workspaceId: string;
	repoPath: string;
	name: string;
	lastUpdated: number;
}

export async function loadWorkspaceContext(repoPath: string): Promise<WorkspaceContext> {
	const db = getDb();
	const existing = db.prepare("SELECT id, name FROM workspaces WHERE repo_path = ?").get(repoPath) as
		| { id: string; name: string }
		| undefined;
	if (existing) {
		return { workspaceId: existing.id, repoPath, name: existing.name, lastUpdated: 0 };
	}

	const workspaceId = randomBytes(4).toString("hex");
	const name = repoPath.split("/").pop() ?? repoPath;
	const now = Date.now();
	db.prepare(
		"INSERT INTO workspaces (id, repo_path, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)",
	).run(workspaceId, repoPath, name, now, now);

	return { workspaceId, repoPath, name, lastUpdated: 0 };
}

export async function listWorkspaces(): Promise<WorkspaceContext[]> {
	const db = getDb();
	const rows = db.prepare("SELECT id, repo_path, name FROM workspaces WHERE archived_at IS NULL").all() as Array<{
		id: string;
		repo_path: string;
		name: string;
	}>;
	return rows.map((r) => ({
		workspaceId: r.id,
		repoPath: r.repo_path,
		name: r.name,
		lastUpdated: 0,
	}));
}

export async function loadWorkspaceState(
	workspaceId: string,
	repoPath: string,
): Promise<RuntimeWorkspaceStateResponse> {
	const db = getDb();
	const wsRow = db.prepare("SELECT board_revision FROM workspaces WHERE id = ?").get(workspaceId) as
		| { board_revision: number }
		| undefined;
	const revision = wsRow?.board_revision ?? 0;

	const board = loadBoardInternal(workspaceId);
	const projectConfig = loadProjectConfigInternal(workspaceId);

	return {
		workspaceId,
		repoPath,
		board,
		revision,
		projectConfig,
	};
}

export async function saveWorkspaceState(
	workspaceId: string,
	request: RuntimeWorkspaceStateSaveRequest,
): Promise<{ revision: number }> {
	const db = getDb();
	const tx = db.transaction(() => {
		const wsRow = db.prepare("SELECT board_revision FROM workspaces WHERE id = ?").get(workspaceId) as
			| { board_revision: number }
			| undefined;
		const currentRevision = wsRow?.board_revision ?? 0;
		if (request.revision !== currentRevision) {
			throw new Error(`Revision conflict: expected ${currentRevision}, got ${request.revision}`);
		}
		saveBoardInternal(workspaceId, request.board);
		const newRevision = currentRevision + 1;
		db.prepare("UPDATE workspaces SET board_revision = ?, updated_at = ? WHERE id = ?").run(
			newRevision,
			Date.now(),
			workspaceId,
		);
		return { revision: newRevision };
	});
	return tx();
}

export async function clearCardSession(workspaceId: string, cardId: string): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const result = db
			.prepare("UPDATE cards SET worktree_path = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?")
			.run(Date.now(), cardId, workspaceId);
		if (result.changes > 0) bumpBoardRevision(db, workspaceId);
	});
	tx();
}

export async function moveCard(
	workspaceId: string,
	cardId: string,
	targetColumnId: RuntimeBoardColumnId,
	targetIndex?: number,
): Promise<RuntimeBoardData> {
	const db = getDb();
	const tx = db.transaction(() => {
		const cardRow = db
			.prepare("SELECT column_id FROM cards WHERE id = ? AND workspace_id = ?")
			.get(cardId, workspaceId) as { column_id: RuntimeBoardColumnId } | undefined;
		if (!cardRow) return; // already deleted — silently ignore

		const sourceColumnId = cardRow.column_id;
		const sameColumn = sourceColumnId === targetColumnId;

		const sourceCards = db
			.prepare("SELECT id FROM cards WHERE workspace_id = ? AND column_id = ? AND id != ? ORDER BY column_position")
			.all(workspaceId, sourceColumnId, cardId) as Array<{ id: string }>;

		const targetCards: Array<{ id: string }> = sameColumn
			? sourceCards
			: (db
					.prepare("SELECT id FROM cards WHERE workspace_id = ? AND column_id = ? ORDER BY column_position")
					.all(workspaceId, targetColumnId) as Array<{ id: string }>);

		const insertAt = typeof targetIndex === "number" ? targetIndex : targetCards.length;
		const finalTarget = [...targetCards];
		finalTarget.splice(insertAt, 0, { id: cardId });

		const now = Date.now();
		const updateTarget = db.prepare("UPDATE cards SET column_id = ?, column_position = ?, updated_at = ? WHERE id = ?");
		for (let i = 0; i < finalTarget.length; i++) {
			updateTarget.run(targetColumnId, i, now, finalTarget[i]!.id);
		}

		if (!sameColumn) {
			const updateSource = db.prepare("UPDATE cards SET column_position = ?, updated_at = ? WHERE id = ?");
			for (let i = 0; i < sourceCards.length; i++) {
				updateSource.run(i, now, sourceCards[i]!.id);
			}
		}

		bumpBoardRevision(db, workspaceId);
	});
	tx();
	return loadBoardInternal(workspaceId);
}

export async function createCard(
	workspaceId: string,
	data: Pick<RuntimeBoardCard, "description"> &
		Partial<
			Pick<
				RuntimeBoardCard,
				| "type"
				| "agentId"
				| "priority"
				| "readyForDev"
				| "dependsOn"
				| "waitsFor"
				| "subtaskIds"
				| "columnId"
				| "githubIssueUrl"
				| "workflowId"
				| "descriptionAttachments"
				| "branchName"
				| "modelConfig"
				| "activeLevel"
			>
		>,
	baseRef: string,
): Promise<RuntimeBoardCard> {
	const db = getDb();
	const id = generateTaskId();
	const now = Date.now();
	const type = data.type ?? "task";
	const columnId = data.columnId ?? "todo";

	// Snapshot the resolved workflow's per-slot model config onto the card so the
	// ticket can tune cost independently. An explicit modelConfig (edited before
	// creation) wins over the snapshot.
	const projectConfig = loadProjectConfigInternal(workspaceId);
	const workflow = resolveWorkflowForCard(projectConfig.workflows, { workflowId: data.workflowId, type });
	const modelConfig = data.modelConfig ?? snapshotModelConfig(workflow);

	const card: RuntimeBoardCard = {
		id,
		description: data.description,
		columnId,
		type,
		readyForDev: data.readyForDev ?? type === "story",
		agentId: data.agentId,
		priority: data.priority,
		dependsOn: data.dependsOn,
		waitsFor: data.waitsFor ?? [],
		subtaskIds: data.subtaskIds ?? [],
		autoFixAttempts: 0,
		activeLevel: data.activeLevel ?? highestWorkflowLevel(workflow),
		modelConfig,
		baseRef,
		createdAt: now,
		updatedAt: now,
		githubIssueUrl: data.githubIssueUrl,
		// Persist the resolved workflow id (not the raw input) so a card always records
		// which workflow it runs — otherwise an omitted workflowId leaves the card unlinked.
		workflowId: data.workflowId ?? workflow?.id,
		descriptionAttachments: data.descriptionAttachments ?? [],
		branchName: data.branchName,
		reviewComments: [],
		activityLog: [],
		terminalSessions: [],
		githubCommentIds: [],
	};

	const tx = db.transaction(() => {
		// Drop a dependsOn pointing at a card that doesn't exist (would fail the FK).
		if (card.dependsOn && !db.prepare("SELECT 1 FROM cards WHERE id = ?").get(card.dependsOn)) {
			card.dependsOn = undefined;
		}
		const countRow = db
			.prepare("SELECT COUNT(*) AS n FROM cards WHERE workspace_id = ? AND column_id = ?")
			.get(workspaceId, columnId) as { n: number };
		upsertCardRow(db, workspaceId, card, countRow.n);
		// Only insert relations (other child rows are empty for a new card).
		replaceCardWaitsFor(db, card.id, card.waitsFor ?? []);
		replaceCardSubtasks(db, card.id, card.subtaskIds ?? []);
		bumpBoardRevision(db, workspaceId);
	});
	tx();

	return card;
}

export async function appendActivityLog(workspaceId: string, cardId: string, message: string): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const exists = db.prepare("SELECT 1 FROM cards WHERE id = ? AND workspace_id = ?").get(cardId, workspaceId);
		if (!exists) return;
		const now = Date.now();
		db.prepare("INSERT INTO activity_log (card_id, timestamp, message) VALUES (?, ?, ?)").run(cardId, now, message);
		db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").run(now, cardId);
	});
	tx();
}

export async function saveTerminalBuffer(workspaceId: string, streamId: string, data: string): Promise<void> {
	const filePath = bufferFilePath(workspaceId, streamId);
	await mkdir(join(workspaceDirPath(workspaceId), "buffers"), { recursive: true });
	await writeFile(filePath, data, "utf-8");
}

export async function loadTerminalBuffer(workspaceId: string, streamId: string): Promise<string> {
	try {
		return await readFile(bufferFilePath(workspaceId, streamId), "utf-8");
	} catch {
		return "";
	}
}

export async function appendTerminalSession(
	workspaceId: string,
	cardId: string,
	entry: RuntimeTerminalSessionEntry,
): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const exists = db.prepare("SELECT 1 FROM cards WHERE id = ? AND workspace_id = ?").get(cardId, workspaceId);
		if (!exists) return;
		db.prepare(
			`INSERT INTO terminal_sessions (card_id, stream_id, type, started_at, ended_at, agent_id, state)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(card_id, stream_id) DO UPDATE SET
					 type = excluded.type,
					 started_at = excluded.started_at,
					 ended_at = excluded.ended_at,
					 agent_id = excluded.agent_id,
					 state = excluded.state`,
		).run(
			cardId,
			entry.streamId,
			entry.type,
			entry.startedAt,
			entry.endedAt ?? null,
			entry.agentId ?? null,
			entry.state ?? null,
		);
		db.prepare("UPDATE cards SET updated_at = ? WHERE id = ?").run(Date.now(), cardId);
	});
	tx();
}

export async function closeAllOpenTerminalSessions(
	workspaceId: string,
	cardId: string,
	endedAt: number,
): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const result = db
			.prepare("UPDATE terminal_sessions SET ended_at = ?, state = 'killed' WHERE card_id = ? AND ended_at IS NULL")
			.run(endedAt, cardId);
		if (result.changes > 0) bumpBoardRevision(db, workspaceId);
	});
	tx();
}

export async function endTerminalSession(
	workspaceId: string,
	cardId: string,
	streamId: string,
	endedAt: number,
	state?: RuntimeTaskSessionState,
): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const result = state
			? db
					.prepare("UPDATE terminal_sessions SET ended_at = ?, state = ? WHERE card_id = ? AND stream_id = ?")
					.run(endedAt, state, cardId, streamId)
			: db
					.prepare("UPDATE terminal_sessions SET ended_at = ? WHERE card_id = ? AND stream_id = ?")
					.run(endedAt, cardId, streamId);
		if (result.changes > 0) bumpBoardRevision(db, workspaceId);
	});
	tx();
}

export async function linkCommentToSession(
	workspaceId: string,
	cardId: string,
	commentCreatedAt: number,
	streamId: string,
): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const result = db
			.prepare("UPDATE review_comments SET stream_id = ? WHERE card_id = ? AND created_at = ?")
			.run(streamId, cardId, commentCreatedAt);
		if (result.changes > 0) bumpBoardRevision(db, workspaceId);
	});
	tx();
}

// Merge a patch into a persisted comment's metadata. Used to record the git
// HEAD a review agent looked at, so the next same-type review can scope its
// diff to only what changed since.
export async function stampReviewCommentMetadata(
	workspaceId: string,
	cardId: string,
	commentCreatedAt: number,
	patch: Record<string, unknown>,
): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const row = db
			.prepare("SELECT metadata_json FROM review_comments WHERE card_id = ? AND created_at = ?")
			.get(cardId, commentCreatedAt) as { metadata_json: string } | undefined;
		if (!row) return;
		const current = safeJsonParse(row.metadata_json, {} as Record<string, unknown>);
		const result = db
			.prepare("UPDATE review_comments SET metadata_json = ? WHERE card_id = ? AND created_at = ?")
			.run(JSON.stringify({ ...current, ...patch }), cardId, commentCreatedAt);
		if (result.changes > 0) bumpBoardRevision(db, workspaceId);
	});
	tx();
}

// bodyHtml: the `body_html` field from GitHub API (application/vnd.github.full+json).
// It contains pre-signed private-user-images.githubusercontent.com URLs that are
// downloadable server-side. When provided, we use those instead of the raw asset URLs.
// Extracts UUID → signed CDN URL pairs from a body_html string.
export function extractSignedImageUrls(bodyHtml: string): Map<string, string> {
	const map = new Map<string, string>();
	const cdnPattern = /https:\/\/private-user-images\.githubusercontent\.com\/[^"'<>\s]+/g;
	const uuidPattern = /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\./i;
	for (const cdnUrl of bodyHtml.match(cdnPattern) ?? []) {
		const uuidMatch = cdnUrl.match(uuidPattern);
		if (uuidMatch?.[1]) map.set(uuidMatch[1].toLowerCase(), cdnUrl);
	}
	return map;
}

export async function downloadGithubImages(
	text: string,
	cardId: string,
	_workspaceId: string,
	fetchHtml?: () => Promise<string | undefined>,
): Promise<string> {
	const assetPattern = /https:\/\/github\.com\/user-attachments\/assets\/[^\s"'<>\]]+/g;
	const assetUrls = [...new Set(text.match(assetPattern) ?? [])];
	if (assetUrls.length === 0) return text;

	let signedUrlMap: Map<string, string> | undefined;

	const tryDownload = async (url: string) => {
		const res = await fetch(url);
		if (!res.ok) return null;
		return res;
	};

	let result = text;
	for (const assetUrl of assetUrls) {
		try {
			// Try direct download first (works for public repos)
			let res = await tryDownload(assetUrl);

			// On failure, fetch body_html once and use signed URL
			if (!res && fetchHtml) {
				if (!signedUrlMap) {
					const html = await fetchHtml();
					signedUrlMap = html ? extractSignedImageUrls(html) : new Map();
				}
				const assetUuid = assetUrl.split("/").pop()?.toLowerCase() ?? "";
				const signedUrl = signedUrlMap.get(assetUuid);
				if (signedUrl) res = await tryDownload(signedUrl);
			}

			if (!res) continue;
			const contentType = res.headers.get("content-type") ?? "image/png";
			const extMap: Record<string, string> = {
				"image/png": "png",
				"image/jpeg": "jpg",
				"image/gif": "gif",
				"image/webp": "webp",
			};
			const ext = extMap[contentType.split(";")[0]?.trim() ?? ""] ?? "png";
			const buffer = Buffer.from(await res.arrayBuffer());
			const localPath = await saveAttachment(buffer, ext, cardId);
			const parts = localPath.replace(/\\/g, "/").split("/");
			const filename = parts[parts.length - 1]!;
			const localUrl = `/api/attachments/${encodeURIComponent(cardId)}/${encodeURIComponent(filename)}`;
			result = result.replaceAll(assetUrl, localUrl);
		} catch {
			/* leave original URL on error */
		}
	}
	return result;
}

export async function saveAttachment(data: Buffer, ext: string, cardId: string): Promise<string> {
	const dir = join(ATTACHMENTS_DIR, cardId);
	await mkdir(dir, { recursive: true });
	const hash = createHash("sha256").update(data).digest("hex");
	const filePath = join(dir, `${hash}.${ext}`);
	if (!existsSync(filePath)) {
		await writeFile(filePath, data);
	}
	return filePath;
}

export async function updateCard(
	workspaceId: string,
	cardId: string,
	update: Partial<
		Pick<
			RuntimeBoardCard,
			| "type"
			| "description"
			| "descriptionAttachments"
			| "agentId"
			| "priority"
			| "readyForDev"
			| "dependsOn"
			| "waitsFor"
			| "subtaskIds"
			| "workflowId"
			| "pr"
			| "reviewComments"
			| "autoFixAttempts"
			| "githubCommentIds"
			| "worktreePath"
			| "branchName"
			| "slackMessageTs"
			| "slackChannelId"
			| "plan"
			| "activeLevel"
			| "modelConfig"
		>
	>,
): Promise<RuntimeBoardCard> {
	const db = getDb();
	const tx = db.transaction(() => {
		const row = db.prepare("SELECT * FROM cards WHERE id = ? AND workspace_id = ?").get(cardId, workspaceId) as
			| CardRow
			| undefined;
		if (!row) return null;

		const existing = cardFromRow(row, loadCardChildren(db, cardId));
		const updated: RuntimeBoardCard = { ...existing, ...update, updatedAt: Date.now() };

		// Drop a dependsOn pointing at a card that doesn't exist (would fail the FK).
		if (updated.dependsOn && !db.prepare("SELECT 1 FROM cards WHERE id = ?").get(updated.dependsOn)) {
			updated.dependsOn = undefined;
		}

		// Use column_position from existing row (updateCard doesn't change column placement).
		upsertCardRow(db, workspaceId, updated, row.column_position);

		// Replace relation rows only if they were in the update (otherwise leave untouched).
		if (update.waitsFor !== undefined) replaceCardWaitsFor(db, cardId, update.waitsFor);
		if (update.subtaskIds !== undefined) replaceCardSubtasks(db, cardId, update.subtaskIds);

		// Replace reviewComments rows if it was in the update.
		if (update.reviewComments !== undefined) {
			db.prepare("DELETE FROM review_comments WHERE card_id = ?").run(cardId);
			const insertReview = db.prepare(
				`INSERT INTO review_comments (
					comment_id, card_id, created_at, type, actor_type, actor_id, actor_source,
					status, stream_id, summary, issues_json, attachments_json, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			);
			for (const c of update.reviewComments ?? []) {
				insertReview.run(
					c.id,
					cardId,
					c.createdAt,
					c.type,
					c.actor.type,
					c.actor.id,
					c.actor.source ?? null,
					c.status ?? null,
					c.streamId ?? null,
					c.summary,
					JSON.stringify(c.issues ?? []),
					JSON.stringify(c.attachments ?? []),
					JSON.stringify(c.metadata ?? {}),
				);
			}
		}

		bumpBoardRevision(db, workspaceId);
		return updated;
	});
	const result = tx();
	// Existing callers don't guard against null here — preserve legacy behaviour
	// (cast at the boundary, callers that ignored the return value still work).
	return result as unknown as RuntimeBoardCard;
}

export async function deleteCard(workspaceId: string, cardId: string): Promise<void> {
	const db = getDb();
	const tx = db.transaction(() => {
		const cardRow = db
			.prepare("SELECT column_id FROM cards WHERE id = ? AND workspace_id = ?")
			.get(cardId, workspaceId) as { column_id: RuntimeBoardColumnId } | undefined;
		if (!cardRow) return;

		// Drop still-pending memory proposals from this card before it's gone
		// (memories.origin_card_id is ON DELETE SET NULL, so approved memories
		// survive but pending proposals would otherwise orphan).
		db.prepare("DELETE FROM memories WHERE origin_card_id = ? AND status = 'pending'").run(cardId);

		db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);

		// Renumber remaining cards in the column to keep positions contiguous.
		const remaining = db
			.prepare("SELECT id FROM cards WHERE workspace_id = ? AND column_id = ? ORDER BY column_position")
			.all(workspaceId, cardRow.column_id) as Array<{ id: string }>;
		const updatePos = db.prepare("UPDATE cards SET column_position = ?, updated_at = ? WHERE id = ?");
		const now = Date.now();
		for (let i = 0; i < remaining.length; i++) {
			updatePos.run(i, now, remaining[i]!.id);
		}

		bumpBoardRevision(db, workspaceId);
	});
	tx();

	// Best-effort cleanup of per-card attachment folder.
	try {
		const { rm } = await import("node:fs/promises");
		await rm(join(ATTACHMENTS_DIR, cardId), { recursive: true, force: true });
	} catch {
		// ignore
	}
}

export async function removeWorkspace(workspaceId: string): Promise<void> {
	const db = getDb();
	db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
}
