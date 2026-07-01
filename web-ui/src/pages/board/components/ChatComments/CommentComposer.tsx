import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeVisualComment, TierLevel } from "@runtime-contract";
import { Crosshair, Paperclip, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { ReopenPickerDialog } from "./ReopenPickerDialog";
import { TokenTextarea } from "@/components/TokenTextarea";
import { uploadAttachmentFile } from "@/runtime/attachments";
import { useWrite } from "@/runtime/api-client";
import {
	applyTextareaEdit,
	atomicTokenEdit,
	normalizeAttachmentTokens,
	parseAttachmentTokenNumbers,
} from "@/utils/attachmentTokens";
import { refColor } from "@/utils/refColors";
import { parseWhippedClipboard } from "@/utils/whippedPayload";

interface CommentComposerProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	onRefresh: () => void;
}

// Stable `n` per attachment (never reused), so tokens stay valid across edits.
interface ComposerAttachment {
	n: number;
	file: File;
	dataUrl: string | null;
	name: string;
}

export function CommentComposer({ card, workspaceId, onRefresh }: CommentComposerProps) {
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
	// Structured visual context captured from a Whipped extension paste; posted as
	// a "visual-comment" so the comment renders the referenced elements.
	const [visualComment, setVisualComment] = useState<RuntimeVisualComment | null>(null);
	const [reopenOpen, setReopenOpen] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isReadyForReview = card.columnId === "ready_for_review";

	const { trigger: submitHumanFeedbackTrigger } = useWrite((api) => api("cards/submit-human-feedback").POST());
	const { trigger: addReviewCommentTrigger } = useWrite((api) => api("cards/add-review-comment").POST());
	const { trigger: updateCardTrigger } = useWrite((api) => api("cards/:id").PATCH());

	// Reopen at a chosen tier: set the card's level so a stale agent-set level
	// doesn't carry over to new scope, then reopen.
	const reopenWith = async (level: TierLevel) => {
		if (level !== card.activeLevel) {
			await updateCardTrigger({
				params: { id: card.id },
				body: { workspaceId, cardId: card.id, revision: 0, activeLevel: level },
			});
		}
		setReopenOpen(false);
		await send(true);
	};

	// Shown/sent attachments are derived from the tokens still present in the
	// text, so deleting a `[Attachment #N]` any way (mid-token, select-all, cut)
	// drops it and native undo restores it — we never rewrite text on delete.
	const byN = new Map(attachments.map((a) => [a.n, a]));
	const displayed = parseAttachmentTokenNumbers(message)
		.map((n) => byN.get(n))
		.filter((a): a is ComposerAttachment => Boolean(a));

	const addFiles = (files: FileList | File[]) => {
		const arr = Array.from(files);
		const ta = textareaRef.current;
		if (!arr.length || !ta) return;
		const pos = document.activeElement === ta ? ta.selectionStart : ta.value.length;
		const startN = attachments.reduce((max, a) => Math.max(max, a.n), 0);
		const items: ComposerAttachment[] = arr.map((file, i) => ({
			n: startN + i + 1,
			file,
			dataUrl: null,
			name: file.name,
		}));
		const before = ta.value.slice(0, pos);
		const lead = before && !/\s$/.test(before) ? " " : "";
		const insert = lead + items.map((it) => `[Attachment #${it.n}]`).join(" ");
		setAttachments((prev) => [...prev, ...items]);
		// Insert through the native pipeline so it stays on the undo stack.
		if (!applyTextareaEdit(ta, pos, pos, insert)) setMessage(ta.value.slice(0, pos) + insert + ta.value.slice(pos));
		for (const it of items) {
			if (!it.file.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const url = ev.target?.result as string;
				setAttachments((prev) => prev.map((p) => (p.n === it.n ? { ...p, dataUrl: url } : p)));
			};
			reader.readAsDataURL(it.file);
		}
	};

	const insertText = (text: string) => {
		const ta = textareaRef.current;
		if (!ta) return;
		const pos = document.activeElement === ta ? ta.selectionStart : ta.value.length;
		const before = ta.value.slice(0, pos);
		const lead = before && !/\s$/.test(before) ? "\n\n" : "";
		const insert = lead + text;
		if (!applyTextareaEdit(ta, pos, pos, insert)) setMessage(ta.value.slice(0, pos) + insert + ta.value.slice(pos));
	};

	const removeAttachment = (n: number) => {
		const ta = textareaRef.current;
		if (!ta) return;
		const m = ta.value.match(new RegExp(`\\[Attachment #${n}\\] ?`));
		if (m?.index == null) return;
		const start = m.index;
		const end = start + m[0].length;
		if (!applyTextareaEdit(ta, start, end, "")) setMessage(ta.value.slice(0, start) + ta.value.slice(end));
	};

	const send = async (requestChanges = false) => {
		const { text: normalized, order } = normalizeAttachmentTokens(message);
		const summaryText = normalized.trim();
		const ordered = order.map((n) => byN.get(n)).filter((a): a is ComposerAttachment => Boolean(a));
		if (!requestChanges && !summaryText && ordered.length === 0 && !visualComment) return;
		setSending(true);
		try {
			const uploaded = [];
			for (const a of ordered) uploaded.push(await uploadAttachmentFile(workspaceId, card.id, a.file));
			const atts = uploaded.length > 0 ? uploaded : undefined;

			if (requestChanges) {
				await submitHumanFeedbackTrigger({
					body: {
						workspaceId,
						cardId: card.id,
						comment: summaryText || undefined,
						attachments: atts,
						...(visualComment ? { type: "visual-comment", metadata: { visualComment } } : {}),
					},
				});
			} else {
				await addReviewCommentTrigger({
					body: {
						workspaceId,
						cardId: card.id,
						type: visualComment ? "visual-comment" : "human",
						actor: { type: "human", id: "human" },
						summary: summaryText || (uploaded.length > 0 ? uploaded.map((a) => a.name).join(", ") : ""),
						attachments: atts,
						...(visualComment ? { metadata: { visualComment } } : {}),
					},
				});
			}
			setMessage("");
			setAttachments([]);
			setVisualComment(null);
			onRefresh();
		} finally {
			setSending(false);
		}
	};

	const hasContent = message.trim().length > 0 || displayed.length > 0 || visualComment != null;

	return (
		<>
			<div className="shrink-0 border-t border-[#1e1e28] p-3">
				<input
					ref={fileInputRef}
					type="file"
					accept="*/*"
					multiple
					className="hidden"
					onChange={(e) => {
						if (e.target.files) addFiles(e.target.files);
						e.target.value = "";
					}}
				/>
				<div className="rounded-lg border border-[#2a2a2a] bg-[#111111] focus-within:border-[#3a3a3a] transition-colors">
					{/* Pending attachment previews — derived from tokens in the text */}
					{displayed.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-2">
							{displayed.map((att) => (
								<div key={att.n} className="relative group">
									<span className="absolute -top-1 -left-1 z-10 flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold text-white bg-[#3a3a3a]">
										{att.n}
									</span>
									{att.dataUrl ? (
										<img
											src={att.dataUrl}
											alt={att.name}
											className="h-16 w-16 object-cover rounded border border-[#2a2a2a]"
											title={att.name}
										/>
									) : (
										<div
											className="h-16 w-16 flex flex-col items-center justify-center gap-1 rounded border border-[#2a2a2a] bg-[#161616] px-1"
											title={att.name}
										>
											<Paperclip size={16} className="shrink-0 text-[#8a8f98]" />
											<span className="text-[10px] text-[#8a8f98] w-full text-center truncate">{att.name}</span>
										</div>
									)}
									<button
										onClick={() => removeAttachment(att.n)}
										className="absolute -top-1 -right-1 size-4 rounded-full bg-[#161616] border border-[#3a3a3a] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
									>
										<X size={10} className="text-[#ededed]" />
									</button>
								</div>
							))}
						</div>
					)}
					{/* Visual context captured from a Whipped extension paste */}
					{visualComment && visualComment.elements.length > 0 && (
						<div className="mx-3 mt-2 flex flex-col gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#111111] p-2">
							<div className="flex items-center gap-2">
								<Crosshair size={12} className="text-[#8b5cf6]" />
								<span className="text-[11px] font-medium text-[#8a8f98]">
									Visual context · {visualComment.elements.length}{" "}
									{visualComment.elements.length === 1 ? "element" : "elements"}
								</span>
								<div className="flex-1" />
								<button
									type="button"
									onClick={() => setVisualComment(null)}
									className="text-[11px] text-[#5f6672] hover:text-[#ff3b4d] transition-colors"
								>
									Clear
								</button>
							</div>
							<div className="flex flex-wrap gap-1.5">
								{visualComment.elements.map((el, i) => {
									const label =
										(el.componentChain?.length ? el.componentChain.join(" → ") : el.componentName) ??
										el.elementSelector ??
										"element";
									const src = el.sourceFile
										? `${el.sourceFile.split("/").slice(-1)[0]}${el.sourceLine ? `:${el.sourceLine}` : ""}`
										: null;
									return (
										<span
											key={i}
											className="inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-[#161616] px-1.5 py-0.5 text-[10px] text-[#8a8f98]"
											title={el.elementSelector}
										>
											<span className="text-[#c4baff]">#{i + 1}</span>
											<span className="truncate max-w-[180px]">🧩 {label}</span>
											{src && <span className="text-[#5f6672] font-mono">📄 {src}</span>}
										</span>
									);
								})}
							</div>
						</div>
					)}
					<TokenTextarea
						ref={textareaRef}
						value={message}
						refColorOf={
							visualComment
								? (n) => (n >= 1 && n <= visualComment.elements.length ? refColor(n - 1) : undefined)
								: undefined
						}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							const edit = atomicTokenEdit(e);
							if (edit) {
								if (!applyTextareaEdit(e.currentTarget, edit.start, edit.end, edit.insert)) {
									setMessage(
										e.currentTarget.value.slice(0, edit.start) + edit.insert + e.currentTarget.value.slice(edit.end),
									);
								}
								return;
							}
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								void send();
							}
						}}
						onPaste={(e) => {
							// A paste from the Whipped extension carries a structured payload —
							// insert the instruction text and capture the visual context.
							const payload = parseWhippedClipboard(e.clipboardData.getData("text/html"));
							if (payload) {
								e.preventDefault();
								insertText(payload.description);
								if (payload.visualComment) setVisualComment(payload.visualComment);
								return;
							}
							if (e.clipboardData.files.length > 0) {
								const hasImage = Array.from(e.clipboardData.files).some((f) => f.type.startsWith("image/"));
								if (hasImage) {
									e.preventDefault();
									addFiles(e.clipboardData.files);
								}
							}
						}}
						onDrop={(e) => {
							e.preventDefault();
							if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
						}}
						onDragOver={(e) => e.preventDefault()}
						placeholder="Add a comment… (paste or drop images)"
						rows={5}
						metricsClassName="text-sm text-[#ededed] px-3 pt-3 pb-1 leading-normal placeholder-[#5f6672]"
					/>
					<div className="flex items-center justify-between px-3 pb-2">
						<div className="flex items-center gap-2">
							<button
								onClick={() => fileInputRef.current?.click()}
								className="text-[#5f6672] hover:text-[#8a8f98] transition-colors"
								title="Attach file"
								type="button"
							>
								<Paperclip size={14} />
							</button>
							<span className="text-[10px] text-[#3a3a4a]">↵ Send · ⇧↵ Newline</span>
						</div>
						<div className="flex gap-1.5">
							{isReadyForReview && (
								<Button variant="outlined" size="sm" disabled={sending} onClick={() => setReopenOpen(true)}>
									{hasContent ? "Request Changes" : "Reopen"}
								</Button>
							)}
							<Button size="sm" disabled={sending || !hasContent} onClick={() => void send()}>
								<Send size={11} className="mr-1" />
								Send
							</Button>
						</div>
					</div>
				</div>
			</div>
			{reopenOpen && (
				<ReopenPickerDialog
					currentLevel={card.activeLevel}
					submitting={sending}
					onConfirm={(level) => void reopenWith(level)}
					onClose={() => setReopenOpen(false)}
				/>
			)}
		</>
	);
}
