import type { CanvasDocument } from "@runtime-contract";
import { X } from "lucide-react";
import { CanvasBody } from "@/components/canvas/CanvasBody";

// Full-page overlay, mirroring TaskDialog.tsx's shell — the assistant's own
// sidebar is far too narrow to host the canvas UI, so this surfaces it as a
// dialog instead. Single column (unlike TaskDialog's two-column layout), so
// narrower. Same "props in, no hook of its own" shape as CanvasBody, so
// AssistantPanel owns the one useCanvasVersions call for both the dialog and
// its own reopen-icon visibility check.
export function AssistantCanvasDialog({
	sessionId,
	canvases,
	sendFeedback,
	open,
	onClose,
}: {
	sessionId: string;
	canvases: CanvasDocument[];
	sendFeedback: (text: string) => Promise<void>;
	open: boolean;
	onClose: () => void;
}) {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={onClose} />
			<div className="relative flex flex-col h-[850px] max-h-[calc(100vh-80px)] w-[1000px] max-w-[calc(100vw-80px)] rounded-xl bg-whip-surface border border-whip-border shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
				<CanvasBody
					sessionId={sessionId}
					canvases={canvases}
					sendFeedback={sendFeedback}
					onClose={onClose}
					headerActions={
						<button onClick={onClose} className="text-whip-faint hover:text-whip-text transition-colors">
							<X size={16} />
						</button>
					}
				/>
			</div>
		</div>
	);
}
