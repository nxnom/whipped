-- =====================================================================
-- 007 drop always_inject + project_state
--
-- always_inject only controlled prompt placement, not inclusion — confusing
-- and not worth keeping. project_state (tech_stack/constraints/goals) duplicated
-- the per-project system prompt, so it's removed in favour of one place.
-- =====================================================================

DROP TABLE IF EXISTS project_state;
ALTER TABLE memories DROP COLUMN always_inject;
