-- =====================================================================
-- 019 rename plan -> canvas
--
-- The plan panel is used for more than plans now (questions, reports,
-- findings, mockups — "plan" is one trigger phrase among several), so the
-- feature is renamed "canvas" throughout. SQLite supports RENAME TO /
-- RENAME COLUMN directly (no rebuild needed) and carries index definitions
-- forward automatically — only the index *names* need an explicit
-- drop+recreate to match.
-- =====================================================================

ALTER TABLE companion_plans RENAME TO companion_canvases;
DROP INDEX idx_companion_plans_session;
CREATE INDEX idx_companion_canvases_session ON companion_canvases(session_id, version DESC);

ALTER TABLE companion_saved_plans RENAME TO companion_saved_canvases;
DROP INDEX idx_companion_saved_plans_workspace;
CREATE INDEX idx_companion_saved_canvases_workspace ON companion_saved_canvases(workspace_id);

ALTER TABLE companion_sessions RENAME COLUMN saved_plan_id TO saved_canvas_id;
