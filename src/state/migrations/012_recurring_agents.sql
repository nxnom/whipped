-- =====================================================================
-- 012 recurring agents
--
-- Scheduled, one-shot agents created by the assistant (they can never create
-- themselves). They observe the board and report (no code-write tools) and keep
-- a private `journal` text column that carries state across runs — read at the
-- start of a run, rewritten at the end. Distinct from the project memory system.
--
-- schedule_kind     — 'interval' (run every N seconds) or 'calendar' (cron_expr
--                     in timezone, e.g. "0 9 * * 1" = every Monday 09:00).
-- agent_id/model/effort — a single fixed model pick (no level resolution, unlike
--                     workflow slots — see AgentModelChoice in api-contract).
-- next_run_at       — epoch ms of the next due run; the daemon's recurring-agent
--                     scheduler polls for enabled agents whose next_run_at <= now.
-- =====================================================================

CREATE TABLE recurring_agents (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL,
	name TEXT NOT NULL,
	instructions TEXT NOT NULL DEFAULT '',
	schedule_kind TEXT NOT NULL DEFAULT 'interval',
	interval_seconds INTEGER,
	cron_expr TEXT,
	timezone TEXT,
	agent_id TEXT NOT NULL DEFAULT 'claude',
	model TEXT,
	effort TEXT,
	enabled INTEGER NOT NULL DEFAULT 1,
	last_run_at INTEGER,
	next_run_at INTEGER,
	journal TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_recurring_agents_workspace ON recurring_agents(workspace_id);
CREATE INDEX idx_recurring_agents_due ON recurring_agents(enabled, next_run_at);

CREATE TABLE recurring_agent_runs (
	id TEXT PRIMARY KEY,
	recurring_agent_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	stream_id TEXT,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	status TEXT NOT NULL DEFAULT 'running',
	summary TEXT,
	tokens INTEGER,
	trigger TEXT NOT NULL DEFAULT 'schedule',
	FOREIGN KEY (recurring_agent_id) REFERENCES recurring_agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_recurring_agent_runs_agent ON recurring_agent_runs(recurring_agent_id, started_at);
