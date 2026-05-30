import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import { Paperclip, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { uploadAttachmentFile } from "@/runtime/attachments";
import { useWrite } from "@/runtime/api-client";
import type { PendingAttachment } from "./types";

interface CommentComposerProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	onRefresh: () => void;
}

export function CommentComposer({ card, workspaceId, onRefresh }: CommentComposerProps) {
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isReadyForReview = card.columnId === "ready_for_review";

	const { trigger: submitHumanFeedbackTrigger } = useWrite((api) => api("cards/submit-human-feedback").POST());
	const { trigger: addReviewCommentTrigger } = useWrite((api) => api("cards/add-review-comment").POST());

	const addFiles = (files: FileList | File[]) => {
		for (const file of Array.from(files)) {
			if (file.type.startsWith("image/")) {
				const reader = new FileReader();
				reader.onload = (ev) => {
					setPendingAttachments((prev) => [...prev, { dataUrl: ev.target?.result as string, file, name: file.name }]);
				};
				reader.readAsDataURL(file);
			} else {
				setPendingAttachments((prev) => [...prev, { dataUrl: null, file, name: file.name }]);
			}
		}
	};

	const uploadPending = async () => {
		const uploaded = [];
		for (const att of pendingAttachments) {
			uploaded.push(await uploadAttachmentFile(workspaceId, card.id, att.file));
		}
		return uploaded;
	};

	const send = async (requestChanges = false) => {
		const text = message.trim();
		if (!requestChanges && !text && pendingAttachments.length === 0) return;
		setSending(true);
		try {
			const uploaded = await uploadPending();
			const attachments = uploaded.length > 0 ? uploaded : undefined;

			if (requestChanges) {
				await submitHumanFeedbackTrigger({
					body: { workspaceId, cardId: card.id, comment: text || undefined, attachments },
				});
			} else {
				await addReviewCommentTrigger({
					body: {
						workspaceId,
						cardId: card.id,
						type: "human",
						actor: { type: "human", id: "human" },
						summary: text || (uploaded.length > 0 ? `${uploaded.map((a) => a.name).join(", ")}` : ""),
						attachments,
					},
				});
			}
			setMessage("");
			setPendingAttachments([]);
			onRefresh();
		} finally {
			setSending(false);
		}
	};

	return (
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
			<div className="rounded-lg border border-[#2a2a38] bg-[#0d0d12] focus-within:border-[#3a3a50] transition-colors">
				{/* Pending attachment previews */}
				{pendingAttachments.length > 0 && (
					<div className="flex flex-wrap gap-2 px-3 pt-2">
						{pendingAttachments.map((att, idx) => (
							<div key={idx} className="relative group">
								{att.dataUrl ? (
									<img
										src={att.dataUrl}
										alt={att.name}
										className="h-16 w-16 object-cover rounded border border-[#2a2a38]"
										title={att.name}
									/>
								) : (
									<div
										className="h-16 w-16 flex flex-col items-center justify-center gap-1 rounded border border-[#2a2a38] bg-[#1a1a24] px-1"
										title={att.name}
									>
										<Paperclip size={16} className="shrink-0 text-gray-500" />
										<span className="text-[10px] text-gray-400 w-full text-center truncate">{att.name}</span>
									</div>
								)}
								<button
									onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
									className="absolute -top-1 -right-1 size-4 rounded-full bg-[#1a1a24] border border-[#3a3a50] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<X size={10} className="text-gray-300" />
								</button>
							</div>
						))}
					</div>
				)}
				<textarea
					ref={textareaRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void send();
						}
					}}
					onPaste={(e) => {
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
					rows={2}
					className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-1 resize-none outline-none placeholder-gray-600"
				/>
				<div className="flex items-center justify-between px-3 pb-2">
					<div className="flex items-center gap-2">
						<button
							onClick={() => fileInputRef.current?.click()}
							className="text-[#4a4a5a] hover:text-gray-400 transition-colors"
							title="Attach file"
							type="button"
						>
							<Paperclip size={14} />
						</button>
						<span className="text-[10px] text-[#3a3a4a]">↵ Send · ⇧↵ Newline</span>
					</div>
					<div className="flex gap-1.5">
						{isReadyForReview && (
							<Button variant="outlined" size="sm" disabled={sending} onClick={() => void send(true)}>
								{message.trim() || pendingAttachments.length > 0 ? "Request Changes" : "Reopen"}
							</Button>
						)}
						<Button
							size="sm"
							disabled={sending || (!message.trim() && pendingAttachments.length === 0)}
							onClick={() => void send()}
						>
							<Send size={11} className="mr-1" />
							Send
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
