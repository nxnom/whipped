-- =====================================================================
-- 003 fix workflow PK (and cards → workflows FK)
--
-- workflows.id was incorrectly defined as a global PRIMARY KEY in 001, but
-- workflow IDs like "wf_default" / "wf_story_default" are canonical per-workspace
-- identifiers and repeat across workspaces. Importing legacy project-config.json
-- files surfaces this — saving workspace B's "wf_default" after workspace A's
-- triggers a UNIQUE constraint failure.
--
-- Fix: change workflows PRIMARY KEY to (workspace_id, id).
-- Side effect: cards.workflow_id FK → workflows.id is no longer valid (workflows.id
-- is no longer a standalone unique column). Drop the FK; workflow integrity is
-- enforced by app code instead.
-- =====================================================================

PRAGMA defer_foreign_keys = ON;

-- ── workflows: rebuild with compound PK ─────────────────────────────────────
CREATE TABLE workflows_new (
  id            TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  for_story     INTEGER NOT NULL DEFAULT 0,
  slots_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT INTO workflows_new (id, workspace_id, name, is_default, for_story, slots_json, created_at, updated_at)
  SELECT id, workspace_id, name, is_default, for_story, slots_json, created_at, updated_at FROM workflows;

DROP INDEX IF EXISTS idx_workflows_workspace_default;
DROP TABLE workflows;
ALTER TABLE workflows_new RENAME TO workflows;
CREATE INDEX idx_workflows_workspace_default ON workflows(workspace_id, is_default, for_story);

-- ── cards: rebuild without FK to workflows ──────────────────────────────────
CREATE TABLE cards_new (
  id                              TEXT PRIMARY KEY,
  workspace_id                    TEXT NOT NULL,
  description                     TEXT NOT NULL,
  description_attachments_json    TEXT NOT NULL DEFAULT '[]',
  column_id                       TEXT NOT NULL CHECK (column_id IN (
                                    'todo','in_progress','reopened',
                                    'ready_for_review','blocked','done'
                                  )),
  column_position                 INTEGER NOT NULL,
  type                            TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task','story','subtask')),
  ready_for_dev                   INTEGER NOT NULL DEFAULT 0,
  agent_id                        TEXT CHECK (agent_id IN ('claude','codex','opencode','cursor')),
  priority                        TEXT CHECK (priority IN ('urgent','high','medium','low')),
  auto_fix_attempts               INTEGER NOT NULL DEFAULT 0,
  base_ref                        TEXT NOT NULL,
  workflow_id                     TEXT,
  github_issue_url                TEXT,
  pr_json                         TEXT,
  jira_key                        TEXT,
  jira_url                        TEXT,
  github_comment_ids_json         TEXT NOT NULL DEFAULT '[]',
  worktree_path                   TEXT,
  branch_name                     TEXT,
  shared_worktree_id              TEXT,
  slack_message_ts                TEXT,
  slack_channel_id                TEXT,
  created_at                      INTEGER NOT NULL,
  updated_at                      INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT INTO cards_new SELECT * FROM cards;

DROP INDEX IF EXISTS idx_cards_workspace_column;
DROP INDEX IF EXISTS idx_cards_workflow;
DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;
CREATE INDEX idx_cards_workspace_column ON cards(workspace_id, column_id, column_position);
CREATE INDEX idx_cards_workflow ON cards(workflow_id);
