import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CanvasBody } from "@/components/canvas/CanvasBody";
import { CanvasVersionSelector } from "@/components/canvas/CanvasVersionSelector";
import { useCanvasVersions } from "@/components/canvas/useCanvasVersions";

const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.9;
const DEFAULT_WIDTH = 420;
const WIDTH_STORAGE_KEY = "companion-canvas-width";

const getMaxWidth = () => window.innerWidth * MAX_WIDTH_RATIO;

// Shared between CanvasPanelHeader (rendered inline in the terminal/diff tab
// row) and CanvasPanelBody (rendered in the content row below) so both stay
// in sync on the same selected version without lifting state further up.
export function useCompanionCanvas(sessionId: string, workspaceId: string) {
	const { canvases, sendFeedback } = useCanvasVersions(workspaceId, sessionId);
	const [collapsed, setCollapsed] = useState(false);
	const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
	const latestVersion = canvases[0]?.version ?? null;

	useEffect(() => {
		if (latestVersion !== null) setSelectedVersion(latestVersion);
	}, [latestVersion]);

	return { canvases, sendFeedback, collapsed, setCollapsed, selectedVersion, setSelectedVersion };
}

export function CanvasPanelHeader({ canvas }: { canvas: ReturnType<typeof useCompanionCanvas> }) {
	const { canvases, collapsed, setCollapsed, selectedVersion, setSelectedVersion } = canvas;

	if (canvases.length === 0) return null;

	if (collapsed) {
		return (
			<button onClick={() => setCollapsed(false)} className="text-whip-faint hover:text-whip-text transition-colors">
				<ChevronLeft size={14} />
			</button>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<span className="text-[13px] font-semibold text-whip-text">Canvas</span>
			<CanvasVersionSelector
				canvases={canvases}
				selectedVersion={selectedVersion ?? canvases[0]!.version}
				onSelectVersion={setSelectedVersion}
			/>
			<button onClick={() => setCollapsed(true)} className="text-whip-faint hover:text-whip-text transition-colors">
				<ChevronRight size={14} />
			</button>
		</div>
	);
}

export function CanvasPanelBody({
	sessionId,
	canvas,
}: {
	sessionId: string;
	canvas: ReturnType<typeof useCompanionCanvas>;
}) {
	const { canvases, sendFeedback, collapsed, selectedVersion, setSelectedVersion } = canvas;

	const [width, setWidth] = useState(() => {
		const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
		return stored ? Math.max(MIN_WIDTH, Math.min(getMaxWidth(), parseInt(stored, 10))) : DEFAULT_WIDTH;
	});
	const setPersistedWidth = (w: number) => {
		setWidth(w);
		localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
	};
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	if (canvases.length === 0 || collapsed) return null;

	const onDragStart = (e: React.MouseEvent) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		const onMove = (ev: MouseEvent) => {
			if (!dragRef.current) return;
			const delta = dragRef.current.startX - ev.clientX;
			setPersistedWidth(Math.min(getMaxWidth(), Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
		};
		const onUp = () => {
			dragRef.current = null;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	return (
		<div className="shrink-0 flex overflow-hidden" style={{ width }}>
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-whip-accent/40 active:bg-whip-accent/60 transition-colors bg-whip-border"
			/>
			<div className="flex-1 border-l border-whip-border flex flex-col overflow-hidden bg-whip-bg">
				<CanvasBody
					sessionId={sessionId}
					canvases={canvases}
					sendFeedback={sendFeedback}
					hideHeader
					selectedVersion={selectedVersion}
					onSelectVersion={setSelectedVersion}
				/>
			</div>
		</div>
	);
}
