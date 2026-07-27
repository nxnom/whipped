import type { CanvasBlock, CanvasDocument } from "../../core/api-contract.js";
import { clearCompanionCanvas, getCompanionCanvas, setCompanionCanvas } from "../../server/companion-canvas-store.js";

export const setCompanionCanvasEntry = async (sessionId: string, blocks: CanvasBlock[]): Promise<CanvasDocument> => {
	return setCompanionCanvas(sessionId, blocks);
};

export const getCompanionCanvasEntry = async (sessionId: string): Promise<{ canvas: CanvasDocument | null }> => {
	return { canvas: getCompanionCanvas(sessionId) };
};

export const clearCompanionCanvasEntry = async (sessionId: string): Promise<void> => {
	clearCompanionCanvas(sessionId);
};
