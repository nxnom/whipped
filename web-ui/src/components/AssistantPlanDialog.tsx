import type { PlanDocument } from "@runtime-contract";
import { X } from "lucide-react";
import { PlanBody } from "@/components/plan/PlanBody";

// Full-page overlay, mirroring TaskDialog.tsx's shell — the assistant's own
// sidebar is far too narrow to host the plan UI, so this surfaces it as a
// dialog instead. Single column (unlike TaskDialog's two-column layout), so
// narrower. Same "props in, no hook of its own" shape as PlanBody, so
// AssistantPanel owns the one usePlanVersions call for both the dialog and
// its own reopen-icon visibility check.
export function AssistantPlanDialog({
	sessionId,
	plans,
	sendFeedback,
	open,
	onClose,
}: {
	sessionId: string;
	plans: PlanDocument[];
	sendFeedback: (text: string) => Promise<void>;
	open: boolean;
	onClose: () => void;
}) {
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={onClose} />
			<div className="relative flex flex-col h-[850px] max-h-[calc(100vh-80px)] w-[1000px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
				<PlanBody
					sessionId={sessionId}
					plans={plans}
					sendFeedback={sendFeedback}
					onClose={onClose}
					headerActions={
						<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
							<X size={16} />
						</button>
					}
				/>
			</div>
		</div>
	);
}
