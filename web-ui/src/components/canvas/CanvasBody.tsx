import type { CanvasDocument } from "@runtime-contract";
import { MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { classNames } from "@/utils/classNames";
import { CanvasBlockRenderer } from "./CanvasBlockRenderer";
import { CanvasFeedbackComposer } from "./CanvasFeedbackComposer";
import { CanvasVersionSelector } from "./CanvasVersionSelector";
import type { CanvasAnswers, CanvasComment } from "./types";

// All the interactive canvas-viewing/feedback logic (version selection,
// answers, per-block comments, the composer), independent of how it's
// presented — the two current shells are the companion sidebar
// (CanvasPanel.tsx) and the assistant's full-page dialog
// (AssistantCanvasDialog.tsx). Takes canvases/sendFeedback as props rather
// than fetching them itself, so each shell owns its own single
// data-fetching hook call and decides independently whether to render at all.
export function CanvasBody({
	sessionId,
	canvases,
	sendFeedback,
	headerActions,
	onClose,
}: {
	sessionId: string;
	canvases: CanvasDocument[];
	sendFeedback: (text: string) => Promise<void>;
	headerActions?: React.ReactNode;
	// Fires once feedback actually lands — after Send, or after Approve's
	// follow-up Save/Delete completes (both funnel through the composer's
	// onSent). Shells that are a dismissable dialog (not a sidebar) can use
	// this to close themselves once there's nothing left to act on.
	onClose?: () => void;
}) {
	const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
	const [answers, setAnswers] = useState<CanvasAnswers>({});
	const [comments, setComments] = useState<CanvasComment[]>([]);
	const [commentDraftFor, setCommentDraftFor] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");

	const latestVersion = canvases[0]?.version ?? null;

	// Follow the latest version as new ones arrive; reset staged feedback since
	// it was composed against the previous version's blocks/ids.
	useEffect(() => {
		if (latestVersion === null) return;
		setSelectedVersion(latestVersion);
		setAnswers({});
		setComments([]);
	}, [latestVersion]);

	if (canvases.length === 0) return null;

	const activeCanvas = canvases.find((p) => p.version === selectedVersion) ?? canvases[0]!;
	const isLatest = activeCanvas.version === latestVersion;

	const addComment = (blockId: string) => {
		if (!commentDraft.trim()) return;
		setComments((prev) => [...prev, { id: crypto.randomUUID(), blockId, text: commentDraft.trim() }]);
		setCommentDraftFor(null);
		setCommentDraft("");
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2.5 border-b border-whip-border shrink-0">
				<span className="text-[13px] font-semibold text-whip-text">Canvas</span>
				<div className="flex items-center gap-2">
					<CanvasVersionSelector
						canvases={canvases}
						selectedVersion={activeCanvas.version}
						onSelectVersion={setSelectedVersion}
					/>
					{headerActions}
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
				{activeCanvas.blocks.map((block) => (
					<div key={block.id} className="group relative flex flex-col gap-1.5">
						<CanvasBlockRenderer
							block={block}
							answers={answers}
							onAnswer={(name, value) => setAnswers((prev) => ({ ...prev, [name]: value }))}
							disabled={!isLatest}
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
									{isLatest && (
										<button
											onClick={() => setComments((prev) => prev.filter((existing) => existing.id !== c.id))}
											className="shrink-0 text-whip-faint hover:text-[#ff3b4d] transition-colors"
										>
											<X size={11} />
										</button>
									)}
								</div>
							))}
						{isLatest &&
							(commentDraftFor === block.id ? (
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
							))}
					</div>
				))}
			</div>

			{isLatest && (
				<CanvasFeedbackComposer
					sessionId={sessionId}
					version={activeCanvas.version}
					blocks={activeCanvas.blocks}
					answers={answers}
					comments={comments}
					sendFeedback={sendFeedback}
					onSent={() => {
						setAnswers({});
						setComments([]);
						onClose?.();
					}}
				/>
			)}
		</div>
	);
}
