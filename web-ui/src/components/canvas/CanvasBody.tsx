import type { CanvasDocument } from "@runtime-contract";
import { MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { classNames } from "@/utils/classNames";
import { CanvasBlockRenderer } from "./CanvasBlockRenderer";
import { CanvasFeedbackComposer } from "./CanvasFeedbackComposer";
import type { CanvasAnswers, CanvasComment } from "./types";

// All the interactive canvas-viewing/feedback logic (answers, per-block
// comments, the composer), independent of how it's presented — the two current
// shells are the companion pane (CanvasPanel.tsx) and the assistant's full-page
// dialog (AssistantCanvasDialog.tsx). Takes the canvas/sendFeedback as props
// rather than fetching them itself, so each shell owns its own single
// data-fetching hook call and decides independently whether to render at all.
export function CanvasBody({
	canvas,
	sendFeedback,
	onDismiss,
	headerActions,
	onClose,
	hideHeader,
}: {
	canvas: CanvasDocument;
	sendFeedback: (text: string) => Promise<void>;
	// Clears the canvas once feedback (or an approval) has reached the agent —
	// it's had its say, so the shell goes back to showing the terminal.
	onDismiss: () => Promise<void>;
	headerActions?: React.ReactNode;
	// Fires once feedback actually lands. Shells that are a dismissable dialog
	// (not a pane) can use this to close themselves.
	onClose?: () => void;
	// Hides the built-in title row for shells (e.g. the companion pane) that
	// render that bar elsewhere.
	hideHeader?: boolean;
}) {
	const [answers, setAnswers] = useState<CanvasAnswers>({});
	const [comments, setComments] = useState<CanvasComment[]>([]);
	const [commentDraftFor, setCommentDraftFor] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");

	// A new canvas replaces the last one wholesale — drop staged feedback, since
	// it was composed against the previous canvas's blocks/ids.
	useEffect(() => {
		setAnswers({});
		setComments([]);
	}, [canvas.createdAt]);

	const addComment = (blockId: string) => {
		if (!commentDraft.trim()) return;
		setComments((prev) => [...prev, { id: crypto.randomUUID(), blockId, text: commentDraft.trim() }]);
		setCommentDraftFor(null);
		setCommentDraft("");
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			{!hideHeader && (
				<div className="flex items-center justify-between px-3 py-2.5 border-b border-whip-border shrink-0">
					<span className="text-[13px] font-semibold text-whip-text">Canvas</span>
					{headerActions}
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
				{canvas.blocks.map((block) => (
					<div key={block.id} className="group relative flex flex-col gap-1.5">
						<CanvasBlockRenderer
							block={block}
							answers={answers}
							onAnswer={(name, value) => setAnswers((prev) => ({ ...prev, [name]: value }))}
						/>
						{comments
							.filter((c) => c.blockId === block.id)
							.map((c) => (
								<div
									key={c.id}
									className="flex items-start gap-1.5 ml-1 pl-2.5 py-0.5 border-l border-dashed border-whip-border-hover"
								>
									<MessageSquare size={11} className="mt-0.5 shrink-0 text-whip-faint" />
									<span className="flex-1 text-[11px] text-whip-muted italic">{c.text}</span>
									<button
										onClick={() => setComments((prev) => prev.filter((existing) => existing.id !== c.id))}
										className="shrink-0 text-whip-faint hover:text-[#ff3b4d] transition-colors"
									>
										<X size={11} />
									</button>
								</div>
							))}
						{commentDraftFor === block.id ? (
							<div className="flex flex-col gap-1.5">
								<textarea
									autoFocus
									value={commentDraft}
									onChange={(e) => setCommentDraft(e.target.value)}
									placeholder="Leave a comment on this section…"
									className="w-full resize-none rounded-md bg-whip-panel border border-whip-border px-2.5 py-1.5 text-[12px] text-whip-text placeholder:text-whip-faint outline-none focus:border-whip-border-hover"
									rows={2}
								/>
								<div className="flex items-center gap-2 self-end">
									<button
										onClick={() => {
											setCommentDraftFor(null);
											setCommentDraft("");
										}}
										className="text-[11px] text-whip-muted hover:text-whip-text"
									>
										Cancel
									</button>
									<button
										onClick={() => addComment(block.id)}
										className="text-[11px] text-whip-text hover:text-whip-accent"
									>
										Add
									</button>
								</div>
							</div>
						) : (
							<button
								onClick={() => setCommentDraftFor(block.id)}
								className={classNames(
									"self-start flex items-center gap-1 text-[11px] text-whip-faint hover:text-whip-text transition-opacity",
									"opacity-0 group-hover:opacity-100",
								)}
							>
								<MessageSquarePlus size={12} /> Comment
							</button>
						)}
					</div>
				))}
			</div>

			<CanvasFeedbackComposer
				blocks={canvas.blocks}
				answers={answers}
				comments={comments}
				sendFeedback={sendFeedback}
				onDismiss={onDismiss}
				onSent={() => {
					setAnswers({});
					setComments([]);
					onClose?.();
				}}
			/>
		</div>
	);
}
