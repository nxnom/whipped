-- =====================================================================
-- 004 review_comments PK fix
--
-- 002 defined review_comments with PRIMARY KEY (card_id, created_at), which
-- assumed createdAt is unique per card. In practice two PR comments can land
-- on the same millisecond (or the poller can merge in a duplicate), tripping
-- the UNIQUE constraint:
--
--   SqliteError: UNIQUE constraint failed: review_comments.card_id, review_comments.created_at
--
-- Replace the composite PK with a synthetic AUTOINCREMENT id. Keep
-- (card_id, created_at) as a non-unique index so the linkCommentToSession
-- lookup stays fast (it updates all rows matching the timestamp, which is
-- the correct behaviour when duplicates do exist).
-- =====================================================================

PRAGMA defer_foreign_keys = ON;

CREATE TABLE review_comments_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
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
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

INSERT INTO review_comments_new
  (card_id, created_at, type, actor_type, actor_id, actor_source,
   status, stream_id, summary, issues_json, attachments_json, metadata_json)
  SELECT card_id, created_at, type, actor_type, actor_id, actor_source,
         status, stream_id, summary, issues_json, attachments_json, metadata_json
  FROM review_comments;

DROP INDEX IF EXISTS idx_review_comments_stream;
DROP TABLE review_comments;
ALTER TABLE review_comments_new RENAME TO review_comments;

CREATE INDEX idx_review_comments_card_time ON review_comments(card_id, created_at);
CREATE INDEX idx_review_comments_stream
  ON review_comments(stream_id)
  WHERE stream_id IS NOT NULL;
