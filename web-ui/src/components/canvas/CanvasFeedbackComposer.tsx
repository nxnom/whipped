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
	onDismiss,
	onSent,
}: {
	blocks: CanvasBlock[];
	answers: CanvasAnswers;
	comments: CanvasComment[];
	sendFeedback: (text: string) => Promise<void>;
	onDismiss: () => Promise<void>;
	onSent: () => void;
}) {
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);

	// The only gate on Send: something has to be staged, or the agent gets a
	// message with nothing in it. Deliberately satisfied by an answer or a block
	// comment alone, not just the note — picking a design or answering the
	// questions IS the feedback, and demanding free text on top of that would
	// mean typing "ok" to get past a field.
	const hasContent = comments.length > 0 || note.trim().length > 0 || Object.keys(answers).length > 0;

	// A question's `required` flag is a signal to the agent, never an enforced
	// gate — a developer who'd rather leave a comment ("none of these options
	// fit, add one for X") must be able to submit without picking a wrong answer
	// to satisfy it, and Approve stays available unconditionally. The composed
	// message always states unanswered questions explicitly (see compose.ts), so
	// the agent decides whether to re-ask rather than reading silence as
	// "resolved".
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

		// Sending anything retires the canvas: the message is with the agent, and
		// what the developer wants next is the terminal, to watch it respond. A
		// follow-up canvas takes its place when the agent pushes one. Clearing is
		// local bookkeeping that happens after the message already landed, so a
		// failure here isn't a failed send.
		await onDismiss().catch(() => {});

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
						<Send size={13} /> Send feedback
					</span>
				</Button>
			</div>
		</div>
	);
}
