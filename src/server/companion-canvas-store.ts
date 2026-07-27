import type { CanvasBlock, CanvasDocument } from "../core/api-contract.js";

// The canvas is deliberately ephemeral: one current document per session, held
// only in the daemon's memory. It is never persisted, never versioned, and is
// dropped when the session it belongs to stops — pushing a new one replaces
// whatever was there. Keyed by an opaque session id (a companion_sessions.id,
// or the assistant agent's synthetic per-workspace id), so this never validates
// the id against any table.
const canvases = new Map<string, CanvasDocument>();

export function setCompanionCanvas(sessionId: string, blocks: CanvasBlock[]): CanvasDocument {
	const canvas: CanvasDocument = { createdAt: Date.now(), blocks };
	canvases.set(sessionId, canvas);
	return canvas;
}

export function getCompanionCanvas(sessionId: string): CanvasDocument | null {
	return canvases.get(sessionId) ?? null;
}

export function clearCompanionCanvas(sessionId: string): void {
	canvases.delete(sessionId);
}
