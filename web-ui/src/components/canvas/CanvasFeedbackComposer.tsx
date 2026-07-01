import { Button, Dialog, Textarea, toast } from "@geckoui/geckoui";
import type { CanvasBlock } from "@runtime-contract";
import { Check, Send } from "lucide-react";
import { useState } from "react";
import { CanvasApproveOutcomeDialog } from "./CanvasApproveOutcomeDialog";
import { composeCanvasFeedbackMessage } from "./compose";
import type { CanvasAnswers, CanvasComment } from "./types";

export function CanvasFeedbackComposer({
	sessionId,
	version,
	blocks,
	answers,
	comments,
	sendFeedback,
	onSent,
}: {
	sessionId: string;
	version: number;
	blocks: CanvasBlock[];
	answers: CanvasAnswers;
	comments: CanvasComment[];
	sendFeedback: (text: string) => Promise<void>;
	onSent: () => void;
}) {
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);

	const hasContent = comments.length > 0 || note.trim().length > 0 || Object.keys(answers).length > 0;

	const submit = async (composed: string, successMessage: string) => {
		setSending(true);
		try {
			await sendFeedback(composed);
			setNote("");
			onSent();
			toast.success(successMessage);
		} catch {
			toast.error("Failed to send feedback");
		} finally {
			setSending(false);
		}
	};

	// "required" is a signal to the agent, not an enforced UI gate — Send/Approve
	// are never blocked. A developer who only wants to leave a comment (e.g.
	// "none of these options fit, add one for X") has to be able to submit
	// without picking a wrong answer just to satisfy a required field. The
	// composed message always states unanswered questions explicitly (see
	// compose.ts), so the agent can decide whether to re-ask in its next canvas
	// version rather than assuming silence means "resolved".
	const handleSend = () =>
		void submit(composeCanvasFeedbackMessage(version, blocks, answers, comments, note, false), "Feedback sent");

	// Approve doesn't send anything by itself — it only opens the Save/Delete
	// dialog. Nothing reaches the agent until that dialog's Save or Delete is
	// clicked, and even then it's exactly one message (the approval folded
	// together with the save instruction, or the approval alone for delete).
	// Dismissing the dialog leaves everything staged, unsent.
	const handleApprove = () => {
		Dialog.show({
			content: ({ dismiss }) => (
				<CanvasApproveOutcomeDialog
					dismiss={dismiss}
					sessionId={sessionId}
					sendFeedback={sendFeedback}
					composedApproval={composeCanvasFeedbackMessage(version, blocks, answers, comments, note, true)}
					onSent={() => {
						setNote("");
						onSent();
					}}
				/>
			),
		});
	};

	return (
		<div className="flex flex-col gap-2 border-t border-[#2a2a35] p-3 shrink-0">
			<Textarea
				placeholder="Anything else to add? (optional)"
				value={note}
				onChange={(e) => setNote(e.target.value)}
				rows={2}
			/>
			<div className="flex items-center gap-2 self-end">
				<Button size="sm" variant="outlined" disabled={sending} onClick={handleApprove}>
					<span className="flex items-center gap-1.5">
						<Check size={13} /> Approve
					</span>
				</Button>
				<Button size="sm" disabled={!hasContent || sending} onClick={handleSend}>
					<span className="flex items-center gap-1.5">
						<Send size={13} /> Send
					</span>
				</Button>
			</div>
		</div>
	);
}
