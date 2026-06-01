-- =====================================================================
-- 010 review_comments stable application id
--
-- The integer `id` PK from 004 is AUTOINCREMENT and gets regenerated on
-- every card save (updateCard wipes + re-inserts all of a card's comments),
-- so it can't be used as a stable handle by the API/UI. Add a separate
-- `comment_id` TEXT that is generated once at creation and carried on the
-- in-memory comment, so it survives the delete+reinsert save cycle and gives
-- callers a stable id to address (e.g. DELETE a single comment).
-- =====================================================================

ALTER TABLE review_comments ADD COLUMN comment_id TEXT;

-- Backfill existing rows with a random 16-hex-char id (matches generateTaskId).
UPDATE review_comments SET comment_id = lower(hex(randomblob(8))) WHERE comment_id IS NULL;

CREATE INDEX idx_review_comments_comment_id ON review_comments(comment_id);
