import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { CanvasBody } from "@/components/canvas/CanvasBody";
import { useCanvasVersions } from "@/components/canvas/useCanvasVersions";

const MIN_WIDTH = 320;
const MAX_WIDTH_RATIO = 0.9;
const DEFAULT_WIDTH = 420;
const WIDTH_STORAGE_KEY = "companion-canvas-width";

const getMaxWidth = () => window.innerWidth * MAX_WIDTH_RATIO;

export function CanvasPanel({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
	const { canvases, sendFeedback } = useCanvasVersions(workspaceId, sessionId);

	const [collapsed, setCollapsed] = useState(false);
	const [width, setWidth] = useState(() => {
		const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
		return stored ? Math.max(MIN_WIDTH, Math.min(getMaxWidth(), parseInt(stored, 10))) : DEFAULT_WIDTH;
	});
	const setPersistedWidth = (w: number) => {
		setWidth(w);
		localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
	};
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	if (canvases.length === 0) return null;

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

	if (collapsed) {
		return (
			<div className="shrink-0 flex flex-col items-center border-l border-[#2a2a2a] bg-[#0b0b0b] w-8 py-3">
				<button onClick={() => setCollapsed(false)} className="text-[#5f6672] hover:text-[#ededed] transition-colors">
					<ChevronLeft size={14} />
				</button>
			</div>
		);
	}

	return (
		<div className="shrink-0 flex overflow-hidden" style={{ width }}>
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-[#ffffff]/40 active:bg-[#ffffff]/60 transition-colors bg-[#2a2a2a]"
			/>
			<div className="flex-1 border-l border-[#2a2a2a] flex flex-col overflow-hidden bg-[#0b0b0b]">
				<CanvasBody
					sessionId={sessionId}
					canvases={canvases}
					sendFeedback={sendFeedback}
					headerActions={
						<button
							onClick={() => setCollapsed(true)}
							className="text-[#5f6672] hover:text-[#ededed] transition-colors"
						>
							<ChevronRight size={14} />
						</button>
					}
				/>
			</div>
		</div>
	);
}
