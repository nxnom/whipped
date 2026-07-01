-- =====================================================================
-- 018 generalize companion_plans' session reference
--
-- companion_plans.session_id carried a hard FK to companion_sessions(id),
-- which the assistant agent's synthetic per-workspace session id
-- (__assistant__:<workspaceId>, see ASSISTANT_AGENT_PREFIX) can never satisfy
-- since it has no companion_sessions row. Rebuilding it as a soft reference —
-- same convention already used by companion_saved_plans.source_session_id —
-- lets the same table store plan versions for either kind of session.
--
-- SQLite can't drop a FK in place, so rebuild (as in 013_agent_id_add_mimo.sql).
-- =====================================================================

CREATE TABLE companion_plans_new (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	blocks_json TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

INSERT INTO companion_plans_new (id, session_id, workspace_id, version, blocks_json, created_at)
	SELECT id, session_id, workspace_id, version, blocks_json, created_at FROM companion_plans;

DROP INDEX IF EXISTS idx_companion_plans_session;
DROP TABLE companion_plans;
ALTER TABLE companion_plans_new RENAME TO companion_plans;
CREATE INDEX idx_companion_plans_session ON companion_plans(session_id, version DESC);
