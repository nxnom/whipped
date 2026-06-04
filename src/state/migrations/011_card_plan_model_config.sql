-- =====================================================================
-- 011 card plan + per-ticket model config
--
-- plan              — text written by the one-shot plan agent, injected into
--                     the dev agent's prompt.
-- active_level      — workflow-wide capability level; every slot resolves it to
--                     its own model pair (see resolvePair in api-contract).
-- model_config_json — snapshot of each slot's model pairs, copied from the
--                     workflow at card creation and editable per ticket.
-- =====================================================================

ALTER TABLE cards ADD COLUMN plan TEXT;
ALTER TABLE cards ADD COLUMN active_level TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE cards ADD COLUMN model_config_json TEXT;
