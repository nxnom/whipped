-- =====================================================================
-- 005 forbid self-referential card dependencies
--
-- card_dependencies allowed (card_id = depends_on_id) — a card depending
-- on itself. The DB wouldn't fail but the semantics are broken. Add a
-- CHECK constraint by recreating the table.
-- =====================================================================

PRAGMA defer_foreign_keys = ON;

CREATE TABLE card_dependencies_new (
  card_id         TEXT NOT NULL,
  depends_on_id   TEXT NOT NULL,
  PRIMARY KEY (card_id, depends_on_id),
  CHECK (card_id != depends_on_id),
  FOREIGN KEY (card_id)       REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Skip any pre-existing self-references when copying (shouldn't happen, but
-- be defensive in case any slipped in before the check existed).
INSERT INTO card_dependencies_new (card_id, depends_on_id)
  SELECT card_id, depends_on_id FROM card_dependencies WHERE card_id != depends_on_id;

DROP INDEX IF EXISTS idx_card_deps_dep;
DROP TABLE card_dependencies;
ALTER TABLE card_dependencies_new RENAME TO card_dependencies;
CREATE INDEX idx_card_deps_dep ON card_dependencies(depends_on_id);
