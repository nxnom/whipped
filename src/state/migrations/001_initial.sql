-- =====================================================================
-- 001 initial — core state (workspaces, workflows, configs)
--
-- Replaces:
--   ~/.whipped/config.json
--   ~/.whipped/projects-layout.json
--   ~/.whipped/workspaces/index.json
--   ~/.whipped/workspaces/<id>/project-config.json
--
-- Board state (board.json + meta.json) moves in 002.
-- Memory subsystem (banks, memories, pending) is a later migration.
-- =====================================================================

-- =====================================================================
-- WORKSPACES
-- =====================================================================
-- ID matches existing format: randomBytes(4).toString("hex") → 8 hex chars.
-- settings_json holds the rest of runtimeProjectConfigSchema (autonomousModeEnabled,
-- autoPR, autoCommit, defaultAgent, gitInstructions, systemPrompt, previewUrl, etc.).
CREATE TABLE workspaces (
  id              TEXT PRIMARY KEY,
  repo_path       TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  git_remote_url  TEXT,
  settings_json   TEXT NOT NULL DEFAULT '{}',
  archived_at     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- =====================================================================
-- WORKSPACE INTEGRATIONS (github, jira, slack)
-- =====================================================================
-- config_json shape per type matches existing zod schemas
-- (runtimeGithubConfigSchema, runtimeJiraConfigSchema, slack pieces).
-- Tokens currently live here inline; future migration may move them to
-- workspace_secrets with encryption.
CREATE TABLE workspace_integrations (
  workspace_id  TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('github', 'jira', 'slack')),
  enabled       INTEGER NOT NULL DEFAULT 0,
  config_json   TEXT NOT NULL DEFAULT '{}',
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, type),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- =====================================================================
-- WORKSPACE SECRETS (matches existing runtimeProjectSecretSchema)
-- =====================================================================
CREATE TABLE workspace_secrets (
  workspace_id  TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  PRIMARY KEY (workspace_id, key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- =====================================================================
-- WORKFLOWS (per-workspace, multiple named; for_story distinguishes
-- task-mode workflows from story-mode workflows)
-- =====================================================================
CREATE TABLE workflows (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  for_story     INTEGER NOT NULL DEFAULT 0,
  slots_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_workflows_workspace_default
  ON workflows(workspace_id, is_default, for_story);

-- =====================================================================
-- GLOBAL CONFIG (singleton; parsed via runtimeGlobalConfigSchema)
-- =====================================================================
CREATE TABLE global_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL
);

INSERT INTO global_config (id, config_json, updated_at)
VALUES (1, '{}', strftime('%s', 'now') * 1000);

-- =====================================================================
-- PROJECTS LAYOUT (singleton; sidebar folder/order; parsed via projectsLayoutSchema)
-- =====================================================================
CREATE TABLE projects_layout (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  layout_json TEXT NOT NULL DEFAULT '{"version":1,"topLevel":[],"folders":{}}',
  updated_at  INTEGER NOT NULL
);

INSERT INTO projects_layout (id, layout_json, updated_at)
VALUES (1, '{"version":1,"topLevel":[],"folders":{}}', strftime('%s', 'now') * 1000);
