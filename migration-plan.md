# Migration Plan — JSON → SQLite

End-to-end plan for migrating whipped state from JSON files to SQLite. Memory subsystem is **deferred** — built on top of SQLite *after* the migration is done.

## Goals

- All queryable state in SQLite (`~/.whipped/whipped.db`), single file, WAL mode.
- Migrations are file-based, transactional, auto-run on daemon start.
- No backward compatibility — solo user, can nuke `~/.whipped/` and start clean.
- Land in two phases: **001 core** (workspaces/workflows/config), **002 board** (cards + everything attached to them). Memory follows in a later migration.

## What goes where

| Current location | Going to |
|---|---|
| `~/.whipped/config.json` | `global_config` singleton table (001) |
| `~/.whipped/projects-layout.json` | `projects_layout` singleton table (001) |
| `~/.whipped/workspaces/index.json` | `workspaces` table (001) |
| `~/.whipped/workspaces/<id>/meta.json` | `workspaces.board_revision` column (002) + `settings_json` |
| `~/.whipped/workspaces/<id>/project-config.json` | `workspaces.settings_json` + `workflows` + `workspace_integrations` + `workspace_secrets` (001) |
| `~/.whipped/workspaces/<id>/board.json` (cards) | `cards` + `card_dependencies` + `activity_log` + `review_comments` + `terminal_sessions` (002) |
| `~/.whipped/workspaces/<id>/buffers/<streamId>.ansi` | **Stay as files** (binary, not queryable) |
| `~/.whipped/attachments/<cardId>/<hash>.<ext>` | **Stay as files** |
| `.mcp.json` (per repo) | **Stay as files** (interop convention) |

## Folder layout in repo (after memory phase, future)

The only file added inside a repo will eventually be the memory folder:

```
<repo>/.whipped/
  memory/             ← added in the memory phase (future), not now
```

No `config.json`, no `prompts/`, no `workflows/` in the repo. Everything else lives in SQLite user-local.

## Migration system

### File layout

```
src/state/
  db.ts                    ← connection + migration runner
  migrations/
    001_initial.sql
    002_board_state.sql
    003_memory.sql         ← future, when memory work begins
```

### Build note

esbuild ignores `.sql` files. `scripts/build.mjs` must copy `src/state/migrations/*.sql` into `dist/state/migrations/` so the runner can find them at runtime.

### Runner (`src/state/db.ts`)

```typescript
import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { logger } from '../core/logger.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const DB_PATH = process.env.WHIPPED_DB_PATH ?? join(homedir(), '.whipped', 'whipped.db');

export function openDb(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = Number.parseInt(file.split('_')[0]!, 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    logger.info({ file, version }, 'Running migration');

    const tx = db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    });

    try {
      tx();
    } catch (err) {
      logger.error({ err, file }, 'Migration failed; rolled back');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
```

Daemon startup calls `openDb()` before anything else. Each migration runs in a transaction; failure rolls back and aborts startup. Adding a migration = drop a new `00N_<name>.sql` file.

## Zod schema changes (for `src/core/api-contract.ts`)

Add a discriminated union for prompts and update `workflowSlotSchema` so future prompt editing can switch between inline text and a file reference. This is a JSON-shape change inside `workflows.slots_json`; no separate `prompts` table.

```typescript
export const promptValueSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("inline"), text: z.string() }),
  z.object({ source: z.literal("file"),   path: z.string() }),
]);
export type PromptValue = z.infer<typeof promptValueSchema>;

export const workflowSlotSchema = z.object({
  id: z.string(),
  type: workflowSlotTypeSchema,
  name: z.string(),
  agentBinary: runtimeAgentIdSchema,
  order: z.number().int().nonnegative(),
  enabled: z.boolean(),
  prompt: promptValueSchema.default({ source: "inline", text: "" }),
  effort: effortLevelSchema.nullable().optional(),
  model: z.string().nullable().optional(),
});
```

`DEFAULT_WORKFLOW` and `DEFAULT_STORY_WORKFLOW` update their slot `prompt: ""` to `prompt: { source: "inline", text: "" }`.

Project-level `systemPrompt` and `gitInstructions` stay as plain strings for now (not converting — scope creep).

---

## `001_initial.sql` — core state

Replaces: `config.json`, `projects-layout.json`, `workspaces/index.json`, `workspaces/<id>/project-config.json`.

```sql
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
  slots_json    TEXT NOT NULL,     -- JSON array of workflowSlotSchema
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
```

---

## `002_board_state.sql` — cards + everything attached

Replaces: `workspaces/<id>/board.json` and `workspaces/<id>/meta.json`.

```sql
-- =====================================================================
-- Add board_revision to workspaces (optimistic concurrency, was meta.json)
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
  pr_json                         TEXT,           -- runtimePrMetaSchema
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
-- =====================================================================
-- Existing schema has no comment id; uses createdAt for lookup
-- (see linkCommentToSession in workspace-state.ts). Composite PK
-- (card_id, created_at) preserves that.
-- issues / attachments / metadata are JSON because they're small arrays/objects
-- that aren't queried independently.
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
```

## Mapping JSON shape → SQLite (board)

For implementers porting `workspace-state.ts`:

| JSON path | SQLite location |
|---|---|
| `board.columns[i].taskIds` (ordering) | derived: `cards.column_position` within `(workspace_id, column_id)` |
| `board.cards[id].*` (primitives) | `cards.*` direct columns |
| `board.cards[id].descriptionAttachments` | `cards.description_attachments_json` |
| `board.cards[id].dependsOn` | rows in `card_dependencies` |
| `board.cards[id].pr` | `cards.pr_json` |
| `board.cards[id].githubCommentIds` | `cards.github_comment_ids_json` |
| `board.cards[id].activityLog` | rows in `activity_log` |
| `board.cards[id].reviewComments` | rows in `review_comments` |
| `board.cards[id].terminalSessions` | rows in `terminal_sessions` |
| `board.schemaVersion` | gone — use `PRAGMA user_version` |
| `meta.revision` | `workspaces.board_revision` |
| `meta.autonomousModeEnabled` | `workspaces.settings_json` (already there per existing code) |

## What stays as files

- Terminal buffers (`workspaces/<id>/buffers/*.ansi`) — binary blobs, not queryable.
- Attachments (`attachments/<cardId>/<hash>.<ext>`) — file blobs.
- `.mcp.json` per repo — interop convention with other tools.
- Pino logs — file logs.

## First-run behavior

No back-compat by design. On first daemon start after the migration ships:
- DB at `~/.whipped/whipped.db` doesn't exist → created.
- `001` + `002` run.
- Existing `~/.whipped/{config.json,projects-layout.json,workspaces/}` are ignored (not migrated, not deleted — user can wipe manually).
- Daemon starts with an empty board.

## Phase 3 (deferred) — memory subsystem

After 001 + 002 are implemented and stable, add `003_memory.sql` introducing:

- `banks` — registry of shared banks (one row per subfolder of `~/.whipped/banks/shared/`).
- `workspace_banks` — many-to-many: which workspaces attach which banks.
- `memories_index` + `memories_fts` + triggers — derived index over markdown files in `<repo>/.whipped/memory/` and `~/.whipped/banks/shared/<bank>/`.
- `memory_refs` — `[[wiki-link]]` graph.
- `pending_memories` — agent proposals tied to cards (FK `card_id → cards.id ON DELETE CASCADE` enforced because cards table exists by then).

Memory file format (markdown + YAML frontmatter), lifecycle (auto vs manual approve, ticket-tied pending), and the dev-slot-only write rule are designed but not in this plan — added when 003 is built.

## Enum reference (for JSON-shaped columns)

- Agent: `claude | codex | opencode | cursor`
- Effort: `low | medium | high | xhigh | max`
- Slot type: `dev | code_review | qa | custom | orch`
- Card type: `task | story | subtask`
- Column ID: `todo | in_progress | reopened | ready_for_review | blocked | done`
- Card priority: `urgent | high | medium | low`
- Session state: `running | stopped | completed | failed | killed`
- Review actor: `ai | human | external`
- Review status: `pass | fail | warning | skipped`
- Review severity (in `issues_json`): `blocking | warning | info`
