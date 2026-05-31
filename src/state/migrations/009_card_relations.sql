-- =====================================================================
-- 009 card relations
--
-- Splits the overloaded card_dependencies many-to-many table into three
-- explicit relations:
--   cards.depends_on_id : single-parent stacking. The child continues in the
--                         parent's worktree/branch and starts once the parent
--                         reaches ready_for_review.
--   card_waits_for      : many-parent gate (tasks only). The card starts only
--                         once ALL listed cards are done (merged), in a fresh
--                         worktree branched from baseRef.
--   card_subtasks       : story -> its subtasks. The story triggers its
--                         orchestrator workflow once every subtask is ready.
--
-- Worktree ownership is now resolved at runtime by walking these relations,
-- so the persisted shared_worktree_id column is removed.
-- =====================================================================

DROP TABLE IF EXISTS card_dependencies;

ALTER TABLE cards DROP COLUMN shared_worktree_id;
ALTER TABLE cards ADD COLUMN depends_on_id TEXT REFERENCES cards(id) ON DELETE SET NULL;

CREATE TABLE card_waits_for (
  card_id       TEXT NOT NULL,
  waits_for_id  TEXT NOT NULL,
  PRIMARY KEY (card_id, waits_for_id),
  CHECK (card_id != waits_for_id),
  FOREIGN KEY (card_id)      REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (waits_for_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_card_waits_for_dep ON card_waits_for(waits_for_id);

CREATE TABLE card_subtasks (
  story_id    TEXT NOT NULL,
  subtask_id  TEXT NOT NULL,
  PRIMARY KEY (story_id, subtask_id),
  CHECK (story_id != subtask_id),
  FOREIGN KEY (story_id)   REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (subtask_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_card_subtasks_sub ON card_subtasks(subtask_id);
