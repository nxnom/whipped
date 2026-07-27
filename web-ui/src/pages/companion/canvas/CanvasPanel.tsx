import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { CanvasBody } from "@/components/canvas/CanvasBody";
import { useCanvas } from "@/components/canvas/useCanvas";

// Shared between CanvasPanelHeader (rendered inline in the terminal/diff tab
// row) and CanvasPanelBody (rendered in the content row below) so both agree on
// whether the canvas is showing, without lifting state further up. An open
// canvas takes over the whole terminal pane rather than sitting beside it —
// `open` is what tells the detail view to hide the terminal.
export function useCompanionCanvas(sessionId: string, workspaceId: string) {
	const { canvas, sendFeedback, clearCanvas } = useCanvas(workspaceId, sessionId);
	const [collapsed, setCollapsed] = useState(false);

	// A newly pushed canvas is worth surfacing even if the developer collapsed
	// the previous one to get back to the terminal.
	useEffect(() => {
		if (canvas) setCollapsed(false);
	}, [canvas?.createdAt]);

	return { canvas, sendFeedback, clearCanvas, collapsed, setCollapsed, open: Boolean(canvas) && !collapsed };
}

export function CanvasPanelHeader({ canvas }: { canvas: ReturnType<typeof useCompanionCanvas> }) {
	const { collapsed, setCollapsed } = canvas;

	if (!canvas.canvas) return null;

	if (collapsed) {
		return (
			<button
				onClick={() => setCollapsed(false)}
				className="flex items-center gap-1 text-[11px] text-whip-muted hover:text-whip-text transition-colors"
			>
				<ChevronLeft size={13} />
				Canvas
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-[13px] font-semibold text-whip-text">Canvas</span>
			<button
				onClick={() => setCollapsed(true)}
				className="flex items-center gap-1 text-[11px] text-whip-muted hover:text-whip-text transition-colors"
			>
				Terminal
				<ChevronRight size={13} />
			</button>
		</div>
	);
}

export function CanvasPanelBody({ canvas }: { canvas: ReturnType<typeof useCompanionCanvas> }) {
	const { canvas: doc, sendFeedback, clearCanvas, open } = canvas;

	if (!doc || !open) return null;

	return (
		<div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-whip-bg">
			<CanvasBody canvas={doc} sendFeedback={sendFeedback} onApprove={clearCanvas} hideHeader />
		</div>
	);
}
