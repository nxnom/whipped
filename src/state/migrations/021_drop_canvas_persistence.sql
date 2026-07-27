-- =====================================================================
-- 021 drop canvas persistence
--
-- The canvas is now ephemeral: one current document per session, held only in
-- the daemon's memory (server/companion-canvas-store.ts), replaced on every
-- push and dropped when the session ends. That removes both tables — the
-- per-session version history and the workspace-level saved-canvas library —
-- along with the soft link a session kept to the saved canvas it resumed from
-- or wrote back to.
-- =====================================================================

DROP TABLE IF EXISTS companion_canvases;
DROP TABLE IF EXISTS companion_saved_canvases;

ALTER TABLE companion_sessions DROP COLUMN saved_canvas_id;
