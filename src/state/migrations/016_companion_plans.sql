-- =====================================================================
-- 016 companion plans
--
-- Structured plans a companion agent pushes via the companion_show_plan MCP
-- tool — markdown, mermaid diagrams, and interactive question blocks, stored
-- as JSON. Versioned and append-only: each push is a new row, never an
-- overwrite, so the panel can show a version history. The developer's
-- answers/comments are composed client-side into one message and typed into
-- the agent's terminal — never persisted here or anywhere else.
-- =====================================================================

CREATE TABLE companion_plans (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	version INTEGER NOT NULL,
	blocks_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (session_id) REFERENCES companion_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_companion_plans_session ON companion_plans(session_id, version DESC);
