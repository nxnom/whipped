-- =====================================================================
-- 015 companion sessions: worktree vs main-repo mode
--
-- Adds use_worktree (1 = dedicated git worktree on branch_name branched from
-- base_ref, as before; 0 = work directly in the main repo checkout — no
-- worktree, no new branch) and widens the status CHECK with 'installing' (the
-- worktree-setup install command now runs before the agent spawns). SQLite
-- can't alter a column/CHECK in place, so the table is rebuilt (as in 013).
-- Existing rows all predate this column and were all worktree sessions, so
-- they backfill use_worktree = 1 and branch_name is left as-is (still NOT
-- semantically required to be non-null going forward, hence dropping NOT NULL).
-- =====================================================================

CREATE TABLE companion_sessions_new (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL,
	name TEXT NOT NULL,
	use_worktree INTEGER NOT NULL DEFAULT 1,
	base_ref TEXT NOT NULL,
	branch_name TEXT,
	worktree_path TEXT,
	workflow_id TEXT,
	seed_prompt TEXT NOT NULL DEFAULT '',
	agent_id TEXT NOT NULL DEFAULT 'claude',
	model TEXT,
	effort TEXT,
	status TEXT NOT NULL DEFAULT 'stopped'
		CHECK (status IN ('installing', 'running', 'stopped', 'merged', 'discarded')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

INSERT INTO companion_sessions_new (
	id, workspace_id, name, use_worktree, base_ref, branch_name, worktree_path, workflow_id,
	seed_prompt, agent_id, model, effort, status, created_at, updated_at
)
	SELECT
		id, workspace_id, name, 1, base_ref, branch_name, worktree_path, workflow_id,
		seed_prompt, agent_id, model, effort, status, created_at, updated_at
	FROM companion_sessions;

DROP INDEX IF EXISTS idx_companion_sessions_workspace;
DROP TABLE companion_sessions;
ALTER TABLE companion_sessions_new RENAME TO companion_sessions;
CREATE INDEX idx_companion_sessions_workspace ON companion_sessions(workspace_id);
