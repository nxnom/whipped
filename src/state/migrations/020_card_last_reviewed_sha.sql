-- =====================================================================
-- 020 card last reviewed sha
--
-- last_reviewed_sha — the commit SHA of the GitHub review that most recently
-- moved this card to "reopened". GitHub doesn't dismiss a "changes requested"
-- review when new commits are pushed, so without this the poller would see
-- the same stale review forever and bounce the card back to reopened every
-- time it lands in ready_for_review. Only a review submitted against a
-- different commit than this one is treated as new feedback.
-- =====================================================================

ALTER TABLE cards ADD COLUMN last_reviewed_sha TEXT;
