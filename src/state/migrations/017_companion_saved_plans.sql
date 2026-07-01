-- =====================================================================
-- 017 companion saved plans
--
-- companion_saved_plans — workspace-level plan library. A session's version
--                         history (companion_plans) is consolidated into one
--                         row here when the agent calls companion_save_plan.
-- companion_sessions.saved_plan_id — soft link to the row a session's saves
--                         should update in place, and/or the plan it resumed
--                         from. Nullable, no FK (same convention as workflow_id).
-- =====================================================================

CREATE TABLE companion_saved_plans (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL,
	title TEXT NOT NULL,
	blocks_json TEXT NOT NULL,
	source_session_id TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX idx_companion_saved_plans_workspace ON companion_saved_plans(workspace_id);

ALTER TABLE companion_sessions ADD COLUMN saved_plan_id TEXT;
