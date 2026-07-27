// The developer isn't blocked from sending without answering a required
// question (see CanvasFeedbackComposer) — this just tells them the agent
// considers it important, so a comment-only skip is a deliberate choice.
export function RequiredMark({ required }: { required?: boolean }) {
	if (!required) return null;
	return <span className="text-[#ff3b4d]">*</span>;
}
