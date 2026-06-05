import { Cron } from "croner";
import type {
	AgentModelChoice,
	RecurringAgent,
	RecurringAgentCreateRequest,
	RecurringAgentRun,
	RecurringAgentUpdateRequest,
	RecurringRunStatus,
	RecurringRunTrigger,
	RecurringSchedule,
	RuntimeAgentId,
} from "../core/api-contract.js";
import { generateTaskId } from "../core/task-id.js";
import { getDb } from "./db.js";

const RECENT_RUNS_LIMIT = 20;

// ─── Row mapping ────────────────────────────────────────────────────────────

interface RecurringAgentRow {
	id: string;
	workspace_id: string;
	name: string;
	instructions: string;
	schedule_kind: string;
	interval_seconds: number | null;
	cron_expr: string | null;
	timezone: string | null;
	agent_id: string;
	model: string | null;
	effort: string | null;
	enabled: number;
	last_run_at: number | null;
	next_run_at: number | null;
	journal: string;
	created_at: number;
	updated_at: number;
}

interface RecurringAgentRunRow {
	id: string;
	stream_id: string | null;
	started_at: number;
	ended_at: number | null;
	status: string;
	summary: string | null;
	tokens: number | null;
	trigger: string;
}

function scheduleFromRow(row: RecurringAgentRow): RecurringSchedule {
	if (row.schedule_kind === "calendar") {
		return { kind: "calendar", cronExpr: row.cron_expr ?? "0 9 * * 1", timezone: row.timezone ?? "UTC" };
	}
	return { kind: "interval", intervalSeconds: row.interval_seconds ?? 3600 };
}

function modelFromRow(row: RecurringAgentRow): AgentModelChoice {
	return { agentId: row.agent_id as RuntimeAgentId, model: row.model, effort: (row.effort as never) ?? null };
}

function runFromRow(row: RecurringAgentRunRow): RecurringAgentRun {
	return {
		id: row.id,
		startedAt: row.started_at,
		endedAt: row.ended_at ?? undefined,
		status: row.status as RecurringRunStatus,
		summary: row.summary ?? undefined,
		tokens: row.tokens ?? undefined,
		trigger: row.trigger as RecurringRunTrigger,
		streamId: row.stream_id ?? undefined,
	};
}

function loadRecentRuns(recurringAgentId: string): RecurringAgentRun[] {
	const rows = getDb()
		.prepare(
			"SELECT id, stream_id, started_at, ended_at, status, summary, tokens, trigger FROM recurring_agent_runs WHERE recurring_agent_id = ? ORDER BY started_at DESC LIMIT ?",
		)
		.all(recurringAgentId, RECENT_RUNS_LIMIT) as RecurringAgentRunRow[];
	return rows.map(runFromRow);
}

function agentFromRow(row: RecurringAgentRow): RecurringAgent {
	return {
		id: row.id,
		name: row.name,
		instructions: row.instructions,
		schedule: scheduleFromRow(row),
		model: modelFromRow(row),
		enabled: row.enabled === 1,
		lastRunAt: row.last_run_at ?? undefined,
		nextRunAt: row.next_run_at ?? undefined,
		journal: row.journal,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		recentRuns: loadRecentRuns(row.id),
	};
}

// ─── Schedule maths ──────────────────────────────────────────────────────────

// Next due epoch-ms strictly after `fromMs`. Returns null when a calendar cron
// has no future match (caller leaves next_run_at null → agent goes dormant).
export function computeNextRun(schedule: RecurringSchedule, fromMs: number): number | null {
	if (schedule.kind === "interval") return fromMs + schedule.intervalSeconds * 1000;
	const next = new Cron(schedule.cronExpr, { timezone: schedule.timezone }).nextRun(new Date(fromMs));
	return next ? next.getTime() : null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function listRecurringAgents(workspaceId: string): RecurringAgent[] {
	const rows = getDb()
		.prepare("SELECT * FROM recurring_agents WHERE workspace_id = ? ORDER BY created_at")
		.all(workspaceId) as RecurringAgentRow[];
	return rows.map(agentFromRow);
}

export function getRecurringAgent(id: string): RecurringAgent | null {
	const row = getDb().prepare("SELECT * FROM recurring_agents WHERE id = ?").get(id) as RecurringAgentRow | undefined;
	return row ? agentFromRow(row) : null;
}

// Enabled agents that are due (next_run_at <= now). Drives the daemon loop.
export function getDueRecurringAgents(workspaceId: string, nowMs: number): RecurringAgent[] {
	const rows = getDb()
		.prepare(
			"SELECT * FROM recurring_agents WHERE workspace_id = ? AND enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at",
		)
		.all(workspaceId, nowMs) as RecurringAgentRow[];
	return rows.map(agentFromRow);
}

// ─── Mutations ───────────────────────────────────────────────────────────────

function scheduleColumns(schedule: RecurringSchedule): {
	kind: string;
	intervalSeconds: number | null;
	cronExpr: string | null;
	timezone: string | null;
} {
	if (schedule.kind === "calendar") {
		return { kind: "calendar", intervalSeconds: null, cronExpr: schedule.cronExpr, timezone: schedule.timezone };
	}
	return { kind: "interval", intervalSeconds: schedule.intervalSeconds, cronExpr: null, timezone: null };
}

export function createRecurringAgent(workspaceId: string, req: RecurringAgentCreateRequest): RecurringAgent {
	const id = `ra_${generateTaskId()}`;
	const now = Date.now();
	const sc = scheduleColumns(req.schedule);
	const model = req.model ?? { agentId: "claude" as RuntimeAgentId, model: null, effort: null };
	const enabled = req.enabled ?? true;
	const nextRunAt = enabled ? computeNextRun(req.schedule, now) : null;

	getDb()
		.prepare(
			`INSERT INTO recurring_agents
				(id, workspace_id, name, instructions, schedule_kind, interval_seconds, cron_expr, timezone,
				 agent_id, model, effort, enabled, last_run_at, next_run_at, journal, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			workspaceId,
			req.name,
			req.instructions ?? "",
			sc.kind,
			sc.intervalSeconds,
			sc.cronExpr,
			sc.timezone,
			model.agentId,
			model.model ?? null,
			model.effort ?? null,
			enabled ? 1 : 0,
			null,
			nextRunAt,
			"",
			now,
			now,
		);

	const created = getRecurringAgent(id);
	if (!created) throw new Error("createRecurringAgent: row vanished after insert");
	return created;
}

export function updateRecurringAgent(req: RecurringAgentUpdateRequest): RecurringAgent | null {
	const existing = getRecurringAgent(req.id);
	if (!existing) return null;

	const schedule = req.schedule ?? existing.schedule;
	const model = req.model ?? existing.model;
	const enabled = req.enabled ?? existing.enabled;
	const sc = scheduleColumns(schedule);

	// Recompute next_run_at when the schedule or enabled state changes; otherwise keep it.
	let nextRunAt = existing.nextRunAt ?? null;
	const scheduleChanged = req.schedule !== undefined;
	const enabledChanged = req.enabled !== undefined && req.enabled !== existing.enabled;
	if (!enabled) {
		nextRunAt = null;
	} else if (scheduleChanged || enabledChanged) {
		nextRunAt = computeNextRun(schedule, Date.now());
	}

	getDb()
		.prepare(
			`UPDATE recurring_agents SET
				name = ?, instructions = ?, schedule_kind = ?, interval_seconds = ?, cron_expr = ?, timezone = ?,
				agent_id = ?, model = ?, effort = ?, enabled = ?, next_run_at = ?, journal = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.run(
			req.name ?? existing.name,
			req.instructions ?? existing.instructions,
			sc.kind,
			sc.intervalSeconds,
			sc.cronExpr,
			sc.timezone,
			model.agentId,
			model.model ?? null,
			model.effort ?? null,
			enabled ? 1 : 0,
			nextRunAt,
			req.journal ?? existing.journal,
			Date.now(),
			req.id,
		);

	return getRecurringAgent(req.id);
}

export function deleteRecurringAgent(id: string): void {
	getDb().prepare("DELETE FROM recurring_agents WHERE id = ?").run(id);
}

// The agent's own journal — its private state carried across runs. Written by
// the agent via the update_journal MCP tool, or edited by the user in the UI.
export function setRecurringAgentJournal(id: string, journal: string): void {
	getDb().prepare("UPDATE recurring_agents SET journal = ?, updated_at = ? WHERE id = ?").run(journal, Date.now(), id);
}

// ─── Run lifecycle ─────────────────────────────────────────────────────────

export function startRecurringRun(
	recurringAgentId: string,
	workspaceId: string,
	trigger: RecurringRunTrigger,
	streamId: string,
): string {
	const id = `rar_${generateTaskId()}`;
	getDb()
		.prepare(
			"INSERT INTO recurring_agent_runs (id, recurring_agent_id, workspace_id, stream_id, started_at, status, trigger) VALUES (?, ?, ?, ?, ?, 'running', ?)",
		)
		.run(id, recurringAgentId, workspaceId, streamId, Date.now(), trigger);
	return id;
}

// Mark any runs still "running" as killed — used on startup/shutdown to clear
// sessions orphaned by a daemon restart or crash. Returns how many were cleared.
export function failStaleRecurringRuns(workspaceId: string): number {
	const res = getDb()
		.prepare(
			"UPDATE recurring_agent_runs SET status = 'killed', ended_at = ? WHERE workspace_id = ? AND status = 'running' AND ended_at IS NULL",
		)
		.run(Date.now(), workspaceId);
	return res.changes;
}

export function finishRecurringRun(
	runId: string,
	result: { status: RecurringRunStatus; summary?: string; tokens?: number },
): void {
	getDb()
		.prepare("UPDATE recurring_agent_runs SET ended_at = ?, status = ?, summary = ?, tokens = ? WHERE id = ?")
		.run(Date.now(), result.status, result.summary ?? null, result.tokens ?? null, runId);
}

// Advance the schedule after a run completes (skip-and-reschedule: the next run
// is computed from `now`, never replaying missed slots while the daemon was down).
export function markRecurringRan(recurringAgentId: string): void {
	const agent = getRecurringAgent(recurringAgentId);
	if (!agent) return;
	const now = Date.now();
	const nextRunAt = agent.enabled ? computeNextRun(agent.schedule, now) : null;
	getDb()
		.prepare("UPDATE recurring_agents SET last_run_at = ?, next_run_at = ? WHERE id = ?")
		.run(now, nextRunAt, recurringAgentId);
}
