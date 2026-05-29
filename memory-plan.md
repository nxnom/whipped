# Memory Feature — Plan

Persistent knowledge so agents stop re-discovering the same facts every task.
Scoped to **global** (user-wide) and **project** (per-workspace). SQLite is the
source of truth (no markdown files, no git banks — those were considered and
dropped for simplicity given solo, SQLite-everything usage).

## Design decisions (locked)

- **Two scopes:** `global` (cross-project) and `project` (one workspace). No
  board scope (board == workspace), no org scope (solo), no separate card
  memory (the card row + activity log already hold task state).
- **SQLite is source of truth.** Agents read/write via MCP tools that query the
  DB. If cross-machine sharing is ever needed, add export/import later.
- **State > memory for kanban.** `project_state` (tech stack / constraints /
  goals) is injected wholesale and is the highest-value piece.
- **Pending is a status column**, not a separate table. Deleting a card cascades
  and removes its origin-pending rows.
- **Read + inject for all slots; write for dev only.** Humans write any scope
  via the UI. Memory exists to cut repeated context for every slot.
- **FTS5 first.** Embeddings (sqlite-vec) and relationship edges deferred.
- Dropped `pattern_observation` source type (lowest signal).

## Access matrix

| Capability | Dev | Code Review | QA | Orchestrator | Custom | Human (UI) |
|---|---|---|---|---|---|---|
| Injected memory (index + always_inject + project_state) | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Read tools (search_memory, get_memory) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Write (save_memory) | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ (any scope) |

## Schema — `006_memory.sql`

```sql
CREATE TABLE memories (
  id             TEXT PRIMARY KEY,            -- 8-hex, matches existing ID format
  scope          TEXT NOT NULL CHECK (scope IN ('global','project')),
  workspace_id   TEXT,                        -- set when scope='project', NULL for global
  type           TEXT NOT NULL CHECK (type IN
                   ('fact','convention','decision','preference','rule','lesson','sharp_edge')),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  source_type    TEXT NOT NULL CHECK (source_type IN
                   ('user_correction','explicit_save','task_lesson','manual_human')),
  importance     INTEGER NOT NULL DEFAULT 1,  -- 1-3, drives injection priority when filtering
  always_inject  INTEGER NOT NULL DEFAULT 0,  -- pin critical rules into every prompt
  origin_card_id TEXT,                        -- provenance (nullable)
  origin_agent   TEXT,                        -- JSON {agent,model}
  status         TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  FOREIGN KEY (workspace_id)   REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (origin_card_id) REFERENCES cards(id)      ON DELETE CASCADE,
  CHECK ((scope='project' AND workspace_id IS NOT NULL) OR (scope='global' AND workspace_id IS NULL))
);

CREATE INDEX idx_memories_scope ON memories(scope, workspace_id, status);
CREATE INDEX idx_memories_origin ON memories(origin_card_id);

-- FTS5 over title + content, kept in sync by triggers (contentless external-content table)
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, content='memories', content_rowid='rowid', tokenize='porter unicode61'
);
-- ai / ad / au triggers mirror memories → memories_fts

CREATE TABLE project_state (
  workspace_id TEXT PRIMARY KEY,
  tech_stack   TEXT,        -- free text / JSON
  constraints  TEXT,        -- "no Redis in MVP", etc.
  goals        TEXT,
  updated_at   INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
```

## Retrieval / injection order (dev agent on a card)

1. `always_inject` rules (global + project)
2. `project_state` (injected wholesale)
3. Project memory — all if small (<~40 approved), else FTS-filtered by card text, ordered by importance
4. Global preferences/rules (always small)

Card-level facts come from the card itself (description, activity, comments).
Injected memory carries a "verify before relying — grep referenced files/symbols
still exist" note to guard staleness.

## Approval policy (auto-approve by source_type)

| source_type | project | global |
|---|---|---|
| user_correction | auto | auto |
| explicit_save | auto | auto |
| task_lesson | auto | review |
| manual_human (UI) | n/a — written approved | n/a |

Agent proposal with a non-auto policy → `status='pending'`. Pending rows tied to
a card die when the card is closed/failed/deleted (origin_card_id cascade +
lifecycle hooks).

## MCP tools

- `whipped_save_memory` — **dev slot only.** `{scope, type, title, content, source_type, importance?, always_inject?}` → insert approved or pending per policy.
- `whipped_search_memory` — all slots. FTS query → matching titles/snippets within scope.
- `whipped_get_memory` — all slots. Fetch full content by id.

Slot gating: daemon passes `WHIPPED_SLOT` in the MCP spawn env. Read tools always
register; `save_memory` registers only when `WHIPPED_SLOT === 'dev'`.

## UI surfaces

- **Memory inbox** (per workspace) — pending proposals: approve / edit / reject, with provenance (card, agent, model).
- **Browse / edit** memory per scope (global + project), create/delete.
- **project_state editor** (tech stack / constraints / goals).

## Build phases

1. **`006_memory.sql`** + store layer: `memories` + `project_state` tables, FTS5 + sync triggers, typed read/write/search module, smoke test. *(no agent integration yet)*
2. **tRPC + UI**: memory CRUD, inbox, project_state editor. Human-written memory works end-to-end.
3. **MCP tools + slot gating + injection** into all-slot system prompts (read), dev-only write.
4. **Pending/approve flow + card lifecycle hooks** (close/fail/delete cleanup).

Deferred (separate, later): embeddings (sqlite-vec), relationship edges, cross-machine sharing.
