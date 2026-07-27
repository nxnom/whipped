import { Button, Textarea, toast } from "@geckoui/geckoui";
import type { CanvasBlock } from "@runtime-contract";
import { Check, Send } from "lucide-react";
import { useState } from "react";
import { composeCanvasFeedbackMessage } from "./compose";
import type { CanvasAnswers, CanvasComment } from "./types";

export function CanvasFeedbackComposer({
	blocks,
	answers,
	comments,
	sendFeedback,
	onApprove,
	onSent,
}: {
	blocks: CanvasBlock[];
	answers: CanvasAnswers;
	comments: CanvasComment[];
	sendFeedback: (text: string) => Promise<void>;
	onApprove: () => Promise<void>;
	onSent: () => void;
}) {
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);

	const hasContent = comments.length > 0 || note.trim().length > 0 || Object.keys(answers).length > 0;

	// "required" is a signal to the agent, not an enforced UI gate — Send/Approve
	// are never blocked. A developer who only wants to leave a comment (e.g.
	// "none of these options fit, add one for X") has to be able to submit
	// without picking a wrong answer just to satisfy a required field. The
	// composed message always states unanswered questions explicitly (see
	// compose.ts), so the agent can decide whether to re-ask in its next canvas
	// rather than assuming silence means "resolved".
	const send = async (approved: boolean) => {
		setSending(true);
		try {
			await sendFeedback(composeCanvasFeedbackMessage(blocks, answers, comments, note, approved));
		} catch {
			toast.error("Failed to send feedback");
			setSending(false);
			return;
		}
		setNote("");
		setSending(false);
		onSent();

		// Approving retires the canvas — the agent has the go-ahead and there's
		// nothing left to answer. Clearing is local bookkeeping that happens after
		// the approval already landed, so a failure here isn't a failed approval.
		if (approved) await onApprove().catch(() => {});

		toast.success(approved ? "Canvas approved" : "Feedback sent");
	};

	return (
		<div className="flex flex-col gap-2 border-t border-whip-border p-3 shrink-0">
			<Textarea
				placeholder="Anything else to add? (optional)"
				value={note}
				onChange={(e) => setNote(e.target.value)}
				rows={2}
			/>
			<div className="flex items-center gap-2 self-end">
				<Button size="sm" variant="outlined" disabled={sending} onClick={() => void send(true)}>
					<span className="flex items-center gap-1.5">
						<Check size={13} /> Approve
					</span>
				</Button>
				<Button size="sm" disabled={!hasContent || sending} onClick={() => void send(false)}>
					<span className="flex items-center gap-1.5">
						<Send size={13} /> Send
					</span>
				</Button>
			</div>
		</div>
	);
}
