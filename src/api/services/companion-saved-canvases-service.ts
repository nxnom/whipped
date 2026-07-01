import type { CanvasBlock, CompanionSavedCanvas } from "../../core/api-contract.js";
import { deleteCompanionCanvasesForSession } from "../../state/companion-canvases-store.js";
import {
	createCompanionSavedCanvas,
	deleteCompanionSavedCanvas,
	findCompanionSavedCanvasBySourceSession,
	listCompanionSavedCanvases,
	updateCompanionSavedCanvas,
} from "../../state/companion-saved-canvases-store.js";
import { getCompanionSession, setCompanionSessionSavedCanvasId } from "../../state/companion-sessions-store.js";

export async function listCompanionSavedCanvasesEntry(
	workspaceId: string,
): Promise<{ canvases: CompanionSavedCanvas[] }> {
	return { canvases: listCompanionSavedCanvases(workspaceId) };
}

export async function deleteCompanionSavedCanvasEntry(id: string): Promise<void> {
	deleteCompanionSavedCanvas(id);
}

export async function clearCompanionCanvasesEntry(sessionId: string): Promise<void> {
	deleteCompanionCanvasesForSession(sessionId);
}

// Upserts the canvas this sessionId last saved, so repeated saves track
// progress instead of accumulating duplicates. Two ways to find "the last
// one":
// - A real companion session tracks its link on companion_sessions.saved_canvas_id
//   (needed because a *resumed* session's own id differs from the canvas's
//   source_session_id — the link is the only way to find it).
// - Any other sessionId (e.g. the assistant agent's synthetic per-workspace id,
//   which has no companion_sessions row to store a link on) falls back to
//   matching by source_session_id directly, since that id never changes.
export async function saveCompanionCanvasEntry(
	sessionId: string,
	workspaceId: string,
	title: string,
	blocks: CanvasBlock[],
): Promise<CompanionSavedCanvas> {
	const session = getCompanionSession(sessionId);

	if (session) {
		if (session.savedCanvasId) {
			const updated = updateCompanionSavedCanvas(session.savedCanvasId, { title, blocks });
			if (updated) return updated;
		}
		const created = createCompanionSavedCanvas(workspaceId, { title, blocks, sourceSessionId: sessionId });
		setCompanionSessionSavedCanvasId(sessionId, created.id);
		return created;
	}

	const existing = findCompanionSavedCanvasBySourceSession(sessionId);
	if (existing) {
		const updated = updateCompanionSavedCanvas(existing.id, { title, blocks });
		if (updated) return updated;
	}
	return createCompanionSavedCanvas(workspaceId, { title, blocks, sourceSessionId: sessionId });
}
