-- =====================================================================
-- 002 board state — cards, dependencies, activity, reviews, sessions
--
-- Replaces:
--   ~/.whipped/workspaces/<id>/board.json
--   ~/.whipped/workspaces/<id>/meta.json
--
-- Terminal buffers (.ansi files) and attachments stay as files.
-- =====================================================================

-- =====================================================================
-- Add board_revision to workspaces (was meta.json's `revision` field for
-- optimistic concurrency on full-board saves).
-- =====================================================================
ALTER TABLE workspaces ADD COLUMN board_revision INTEGER NOT NULL DEFAULT 0;

-- =====================================================================
-- CARDS (matches runtimeBoardCardSchema)
-- =====================================================================
-- column_position is an integer; reorder by renumbering within (workspace_id, column_id).
-- Small N per column makes renumbering cheap; sparse-int / lexorank is overkill.
--
-- JSON columns are used for nested shapes we never query independently:
--   description_attachments_json, pr_json, github_comment_ids_json.
-- Activity log, review comments, terminal sessions are normalized below.
CREATE TABLE cards (
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
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id)  REFERENCES workflows(id)  ON DELETE SET NULL
);

CREATE INDEX idx_cards_workspace_column
  ON cards(workspace_id, column_id, column_position);
CREATE INDEX idx_cards_workflow ON cards(workflow_id);

-- =====================================================================
-- CARD DEPENDENCIES (was cards.dependsOn array)
-- =====================================================================
CREATE TABLE card_dependencies (
  card_id         TEXT NOT NULL,
  depends_on_id   TEXT NOT NULL,
  PRIMARY KEY (card_id, depends_on_id),
  FOREIGN KEY (card_id)       REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_card_deps_dep ON card_dependencies(depends_on_id);

-- =====================================================================
-- ACTIVITY LOG (was cards.activityLog array, runtimeActivityEntrySchema)
-- =====================================================================
CREATE TABLE activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id       TEXT NOT NULL,
  timestamp     INTEGER NOT NULL,
  message       TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_activity_card_time ON activity_log(card_id, timestamp);

-- =====================================================================
-- REVIEW COMMENTS (was cards.reviewComments, runtimeReviewCommentSchema)
-- Existing schema has no comment id; uses createdAt for lookup
-- (see linkCommentToSession in workspace-state.ts). Composite PK
-- (card_id, created_at) preserves that.
-- issues / attachments / metadata are JSON because they're small arrays/objects
-- that aren't queried independently.
-- =====================================================================
CREATE TABLE review_comments (
  card_id           TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  type              TEXT NOT NULL,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('ai', 'human', 'external')),
  actor_id          TEXT NOT NULL,
  actor_source      TEXT,
  status            TEXT CHECK (status IN ('pass', 'fail', 'warning', 'skipped')),
  stream_id         TEXT,
  summary           TEXT NOT NULL,
  issues_json       TEXT NOT NULL DEFAULT '[]',
  attachments_json  TEXT NOT NULL DEFAULT '[]',
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (card_id, created_at),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_review_comments_stream
  ON review_comments(stream_id)
  WHERE stream_id IS NOT NULL;

-- =====================================================================
-- TERMINAL SESSIONS (was cards.terminalSessions, runtimeTerminalSessionEntrySchema)
-- Buffers themselves stay as .ansi files under workspaces/<id>/buffers/.
-- =====================================================================
CREATE TABLE terminal_sessions (
  card_id      TEXT NOT NULL,
  stream_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  agent_id     TEXT CHECK (agent_id IN ('claude','codex','opencode','cursor')),
  state        TEXT CHECK (state IN ('running','stopped','completed','failed','killed')),
  PRIMARY KEY (card_id, stream_id),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_terminal_sessions_card ON terminal_sessions(card_id);
