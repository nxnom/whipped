import type { CanvasBlock, CanvasDocument } from "../../core/api-contract.js";
import { createCompanionCanvas, listCompanionCanvases } from "../../state/companion-canvases-store.js";

// Canvas storage is keyed by an opaque sessionId — a real companion_sessions.id,
// or the assistant agent's synthetic per-workspace id — so it deliberately
// does not validate the session against companion_sessions here; the caller
// (route handler) already knows what kind of session it's dealing with.
export const createCompanionCanvasEntry = async (
	sessionId: string,
	workspaceId: string,
	blocks: CanvasBlock[],
): Promise<CanvasDocument> => {
	return createCompanionCanvas(sessionId, workspaceId, blocks);
};

export const listCompanionCanvasesEntry = async (sessionId: string): Promise<{ canvases: CanvasDocument[] }> => {
	return { canvases: listCompanionCanvases(sessionId) };
};
