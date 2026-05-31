-- =====================================================================
-- 007 memory tags — tag-routed global memory
--
-- Global memory is no longer injected into every project. It carries tags;
-- projects subscribe to tags; a global memory reaches a project when they
-- share a tag, when the project is the memory's origin, or when a human
-- explicitly binds the memory to the project by id. See docs/memory-tags.md.
-- =====================================================================

-- Origin workspace for the safety net: a global memory is always visible in
-- the repo that produced it, regardless of tag match. SET NULL on delete so
-- the memory survives if its origin workspace is removed (it then routes by
-- tag/binding only).
ALTER TABLE memories ADD COLUMN origin_workspace_id TEXT
  REFERENCES workspaces(id) ON DELETE SET NULL;

-- Canonical tag vocabulary — one spelling per concept. Both join tables FK
-- into this, so a tag must exist before it can be attached (reuse-first).
CREATE TABLE tags (
  name TEXT PRIMARY KEY            -- normalised lowercase kebab-case
);

-- memory ↔ tag
CREATE TABLE memory_tags (
  memory_id TEXT NOT NULL,
  tag       TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (tag)       REFERENCES tags(name)   ON DELETE CASCADE
);

-- project's subscribed tags (human-curated in project settings)
CREATE TABLE workspace_tags (
  workspace_id TEXT NOT NULL,
  tag          TEXT NOT NULL,
  PRIMARY KEY (workspace_id, tag),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (tag)          REFERENCES tags(name)     ON DELETE CASCADE
);

-- explicit by-id binding of a global memory to a project (human-curated)
CREATE TABLE memory_workspace_bindings (
  memory_id    TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, workspace_id),
  FOREIGN KEY (memory_id)    REFERENCES memories(id)   ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_tags_tag   ON memory_tags(tag);
CREATE INDEX idx_workspace_tags_ws ON workspace_tags(workspace_id);
CREATE INDEX idx_memories_origin_ws ON memories(origin_workspace_id);
