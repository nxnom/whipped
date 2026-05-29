-- =====================================================================
-- 006 memory — scoped agent memory + project state
--
-- Two scopes: 'global' (cross-project, workspace_id NULL) and 'project'
-- (one workspace). SQLite is the source of truth. Pending proposals live
-- in the same table via the status column; rows whose origin card is
-- deleted cascade away.
-- =====================================================================

CREATE TABLE memories (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  workspace_id    TEXT,
  type            TEXT NOT NULL CHECK (type IN (
                    'fact', 'convention', 'decision', 'preference', 'rule', 'lesson', 'sharp_edge'
                  )),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN (
                    'user_correction', 'explicit_save', 'task_lesson', 'manual_human'
                  )),
  importance      INTEGER NOT NULL DEFAULT 1,    -- 1-3, drives injection priority when filtering
  always_inject   INTEGER NOT NULL DEFAULT 0,    -- pin into every prompt
  origin_card_id  TEXT,                           -- provenance (nullable)
  origin_agent    TEXT,                           -- JSON {agent, model}
  status          TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (workspace_id)   REFERENCES workspaces(id) ON DELETE CASCADE,
  -- SET NULL (not CASCADE): deleting a card keeps approved memories it produced,
  -- just dropping the provenance link. Pending proposals are cleaned up
  -- explicitly via deletePendingMemoriesForCard() in the card lifecycle hooks.
  FOREIGN KEY (origin_card_id) REFERENCES cards(id)      ON DELETE SET NULL,
  CHECK (
    (scope = 'project' AND workspace_id IS NOT NULL) OR
    (scope = 'global'  AND workspace_id IS NULL)
  )
);

CREATE INDEX idx_memories_scope  ON memories(scope, workspace_id, status);
CREATE INDEX idx_memories_origin ON memories(origin_card_id);

-- FTS5 over title + content (external-content table mirrors `memories`).
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, content)
  VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO memories_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

-- =====================================================================
-- PROJECT STATE — one row per workspace, injected wholesale into prompts.
-- =====================================================================
CREATE TABLE project_state (
  workspace_id TEXT PRIMARY KEY,
  tech_stack   TEXT,        -- free text / JSON
  constraints  TEXT,        -- e.g. "no Redis in MVP"
  goals        TEXT,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
