-- =====================================================================
-- 013 add 'mimo' to the agent_id CHECK constraint
--
-- mimo (mimocode) is a new supported agent binary. The agent_id columns on
-- `cards` and `terminal_sessions` carry a CHECK constraint that only allowed
-- claude/codex/opencode/cursor, so persisting a mimo card or terminal session
-- failed with "CHECK constraint failed: agent_id IN (...)".
--
-- SQLite can't alter a CHECK constraint in place, so each table is rebuilt with
-- the widened constraint (the standard recreate-and-copy procedure, as in 003).
-- The migration runner disables foreign_keys for the duration of migrations, so
-- dropping the `cards` parent here does NOT cascade-delete its many child tables
-- (activity_log, review_comments, terminal_sessions, card_subtasks, …).
-- =====================================================================

-- ── cards: rebuild with widened agent_id CHECK ──────────────────────────────
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
  agent_id                        TEXT CHECK (agent_id IN ('claude','codex','opencode','cursor','mimo')),
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
  slack_message_ts                TEXT,
  slack_channel_id                TEXT,
  created_at                      INTEGER NOT NULL,
  updated_at                      INTEGER NOT NULL,
  depends_on_id                   TEXT REFERENCES cards(id) ON DELETE SET NULL,
  plan                            TEXT,
  active_level                    TEXT NOT NULL DEFAULT 'medium',
  model_config_json               TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

INSERT INTO cards_new (
  id, workspace_id, description, description_attachments_json, column_id, column_position,
  type, ready_for_dev, agent_id, priority, auto_fix_attempts, base_ref, workflow_id,
  github_issue_url, pr_json, jira_key, jira_url, github_comment_ids_json, worktree_path,
  branch_name, slack_message_ts, slack_channel_id, created_at, updated_at, depends_on_id,
  plan, active_level, model_config_json
)
  SELECT
    id, workspace_id, description, description_attachments_json, column_id, column_position,
    type, ready_for_dev, agent_id, priority, auto_fix_attempts, base_ref, workflow_id,
    github_issue_url, pr_json, jira_key, jira_url, github_comment_ids_json, worktree_path,
    branch_name, slack_message_ts, slack_channel_id, created_at, updated_at, depends_on_id,
    plan, active_level, model_config_json
  FROM cards;

DROP INDEX IF EXISTS idx_cards_workspace_column;
DROP INDEX IF EXISTS idx_cards_workflow;
DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;
CREATE INDEX idx_cards_workspace_column ON cards(workspace_id, column_id, column_position);
CREATE INDEX idx_cards_workflow ON cards(workflow_id);

-- ── terminal_sessions: rebuild with widened agent_id CHECK ──────────────────
CREATE TABLE terminal_sessions_new (
  card_id      TEXT NOT NULL,
  stream_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  agent_id     TEXT CHECK (agent_id IN ('claude','codex','opencode','cursor','mimo')),
  state        TEXT CHECK (state IN ('running','stopped','completed','failed','killed')),
  PRIMARY KEY (card_id, stream_id),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

INSERT INTO terminal_sessions_new (card_id, stream_id, type, started_at, ended_at, agent_id, state)
  SELECT card_id, stream_id, type, started_at, ended_at, agent_id, state FROM terminal_sessions;

DROP INDEX IF EXISTS idx_terminal_sessions_card;
DROP TABLE terminal_sessions;
ALTER TABLE terminal_sessions_new RENAME TO terminal_sessions;
CREATE INDEX idx_terminal_sessions_card ON terminal_sessions(card_id);
