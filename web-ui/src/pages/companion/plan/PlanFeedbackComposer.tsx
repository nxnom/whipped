import { Button, Textarea, toast } from "@geckoui/geckoui";
import type { PlanBlock } from "@runtime-contract";
import { Check, Send, X } from "lucide-react";
import { useState } from "react";
import { composePlanFeedbackMessage } from "./compose";
import type { PlanAnswers, PlanComment } from "./types";

export function PlanFeedbackComposer({
	version,
	blocks,
	answers,
	comments,
	onRemoveComment,
	sendFeedback,
	onSent,
}: {
	version: number;
	blocks: PlanBlock[];
	answers: PlanAnswers;
	comments: PlanComment[];
	onRemoveComment: (id: string) => void;
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

	const handleSend = () =>
		submit(composePlanFeedbackMessage(version, blocks, answers, comments, note, false), "Feedback sent");

	// Always available, independent of whatever else is staged — approving and
	// leaving feedback aren't mutually exclusive, so this folds in any staged
	// answers/comments/note rather than discarding them.
	const handleApprove = () =>
		submit(composePlanFeedbackMessage(version, blocks, answers, comments, note, true), "Plan approved");

	return (
		<div className="flex flex-col gap-2 border-t border-[#2a2a35] p-3 shrink-0">
			{comments.length > 0 && (
				<div className="flex flex-col gap-1.5">
					{comments.map((c) => (
						<div
							key={c.id}
							className="flex items-start gap-2 rounded-md bg-[#1a1a24] border border-[#2a2a38] px-2.5 py-1.5"
						>
							<span className="flex-1 text-[11px] text-gray-300">{c.text}</span>
							<button
								onClick={() => onRemoveComment(c.id)}
								className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
							>
								<X size={12} />
							</button>
						</div>
					))}
				</div>
			)}
			<Textarea
				placeholder="Anything else to add? (optional)"
				value={note}
				onChange={(e) => setNote(e.target.value)}
				rows={2}
			/>
			<div className="flex items-center gap-2 self-end">
				<Button size="sm" variant="outlined" disabled={sending} onClick={() => void handleApprove()}>
					<span className="flex items-center gap-1.5">
						<Check size={13} /> Approve
					</span>
				</Button>
				<Button size="sm" disabled={!hasContent || sending} onClick={() => void handleSend()}>
					<span className="flex items-center gap-1.5">
						<Send size={13} /> Send
					</span>
				</Button>
			</div>
		</div>
	);
}
