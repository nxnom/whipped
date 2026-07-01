-- =====================================================================
-- 014 companion sessions
--
-- Synchronous, chat-driven coding sessions isolated in their own git worktree.
-- Unlike cards, these are not part of the kanban ticket lifecycle — no FK to
-- cards, no dependency graph, no workflow slot pipeline. `workflow_id` is a
-- soft (unenforced) reference: a workflow may be edited or deleted after a
-- session starts without affecting it, since `seed_prompt` already snapshots
-- the workflow's dev-slot prompt text at session-creation time.
--
-- No turn/message history table: like the assistant agent, a companion session
-- is a single persistent interactive terminal stream (keyed by this row's id),
-- backed by the daemon's in-memory session map + RuntimeStateHub's terminal
-- buffer — not by DB rows.
-- =====================================================================

CREATE TABLE companion_sessions (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL,
	name TEXT NOT NULL,
	base_ref TEXT NOT NULL,
	branch_name TEXT NOT NULL,
	worktree_path TEXT,
	workflow_id TEXT,
	seed_prompt TEXT NOT NULL DEFAULT '',
	agent_id TEXT NOT NULL DEFAULT 'claude',
	model TEXT,
	effort TEXT,
	status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'merged', 'discarded')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_companion_sessions_workspace ON companion_sessions(workspace_id);
