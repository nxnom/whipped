import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeReviewComment, WorkflowSlot } from "@runtime-contract";
import { ImagePlus, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentUrl, uploadAttachmentFile } from "@/runtime/attachments";
import { trpc } from "@/runtime/trpc-client";

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ comment }: { comment: RuntimeReviewComment }) {
	const [err, setErr] = useState(false);
	const { actor, type } = comment;

	if (actor.type === "human" || actor.type === "external") {
		const initials = actor.id.slice(0, 2).toUpperCase();
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-700 text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{initials}
			</div>
		);
	}

	const seed = `${type}-${actor.id}`;

	if (err) {
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-700 text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{actor.id.slice(0, 2).toUpperCase()}
			</div>
		);
	}

	return (
		<img
			src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`}
			alt={actor.id}
			className="w-8 h-8 rounded-full shrink-0 bg-gray-800"
			onError={() => setErr(true)}
			loading="lazy"
		/>
	);
}

// ── Display helpers ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
	dev: "Dev",
	code_review: "Code Review",
	qa: "QA",
};

function displayName(comment: RuntimeReviewComment, slots?: WorkflowSlot[]): string {
	const { actor, type } = comment;
	if (actor.type === "human" && actor.id === "human") return "You";
	if (actor.type === "external") return actor.id;
	// AI actor — use type label
	if (TYPE_LABELS[type]) return TYPE_LABELS[type]!;
	const slot = slots?.find((s) => s.id === type);
	if (slot) return slot.name;
	return type.charAt(0).toUpperCase() + type.slice(1);
}

const MODEL_STYLE: Record<string, string> = {
	claude: "text-orange-400 bg-orange-400/10",
	codex: "text-emerald-400 bg-emerald-400/10",
};

function AgentBadge({ comment }: { comment: RuntimeReviewComment }) {
	const { actor, status } = comment;

	if (actor.type === "external") {
		const label = (actor.source ?? "External").charAt(0).toUpperCase() + (actor.source ?? "External").slice(1);
		return (
			<span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium text-gray-400 bg-gray-700/50">
				{label}
			</span>
		);
	}
	if (actor.type === "human") return null;

	// AI actor — color by model so the same model always looks the same
	const className = MODEL_STYLE[actor.id] ?? "text-gray-400 bg-gray-700/50";
	return (
		<span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${className}`}>
			{actor.id}
			{status === "pass" && <span className="text-green-400">✓</span>}
			{status === "fail" && <span className="text-red-400">✗</span>}
			{status === "warning" && <span className="text-yellow-400">⚠</span>}
			{status === "skipped" && <span className="text-gray-400">—</span>}
		</span>
	);
}

// ── Attachment image ──────────────────────────────────────────────────────────

function AttachmentImage({ path, name }: { path: string; name: string }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="mt-1">
			<img
				src={attachmentUrl(path)}
				alt={name}
				className={`rounded border border-gray-700 cursor-pointer object-contain ${expanded ? "max-w-full max-h-96" : "max-h-24 max-w-48"}`}
				onClick={() => setExpanded((v) => !v)}
				title={expanded ? "Click to collapse" : "Click to expand"}
			/>
			<div className="text-[10px] text-gray-600 mt-0.5">{name}</div>
		</div>
	);
}

// ── Severity color ────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
	blocking: "text-red-400",
	warning: "text-yellow-400",
	info: "text-blue-400",
};

// ── Date grouping ─────────────────────────────────────────────────────────────

function formatDateLabel(ts: number): string {
	const d = new Date(ts);
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === today.toDateString()) return "Today";
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function isDifferentDay(a: number, b: number): boolean {
	return new Date(a).toDateString() !== new Date(b).toDateString();
}

interface CommentEntry {
	comment: RuntimeReviewComment;
	sourceCardTitle?: string;
}

function isSameGroup(a: CommentEntry, b: CommentEntry): boolean {
	if (a.sourceCardTitle !== b.sourceCardTitle) return false;
	const keyA = `${a.comment.actor.id}|${a.comment.actor.type}|${a.comment.actor.source ?? ""}|${a.comment.type}`;
	const keyB = `${b.comment.actor.id}|${b.comment.actor.type}|${b.comment.actor.source ?? ""}|${b.comment.type}`;
	return keyA === keyB && b.comment.createdAt - a.comment.createdAt < 5 * 60 * 1000;
}

// ── Markdown components (dark theme) ─────────────────────────────────────────

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
	p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
	strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
	em: ({ children }) => <em className="italic">{children}</em>,
	code: ({ children, className }) => {
		const isBlock = className?.includes("language-");
		return isBlock ? (
			<code className="block bg-gray-800 rounded px-3 py-2 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre my-1">
				{children}
			</code>
		) : (
			<code className="bg-gray-800 rounded px-1 py-0.5 text-xs font-mono text-gray-200">{children}</code>
		);
	},
	pre: ({ children }) => <pre className="my-1 overflow-x-auto">{children}</pre>,
	ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
	ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
	li: ({ children }) => <li className="text-gray-300">{children}</li>,
	blockquote: ({ children }) => (
		<blockquote className="border-l-2 border-gray-600 pl-3 my-1 text-gray-400 italic">{children}</blockquote>
	),
	a: ({ href, children }) => (
		<a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{children}</a>
	),
	h1: ({ children }) => <h1 className="text-base font-semibold text-gray-100 mt-2 mb-1">{children}</h1>,
	h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-100 mt-2 mb-1">{children}</h2>,
	h3: ({ children }) => <h3 className="text-sm font-medium text-gray-200 mt-1 mb-0.5">{children}</h3>,
	hr: () => <hr className="border-gray-700 my-2" />,
};

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	onRefresh: () => void;
}

interface PendingAttachment {
	dataUrl: string; // local preview only
	file: File;
	name: string;
}

export function ChatComments({ card, workspaceId, allCards, workflowSlots, onRefresh }: Props) {
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isReadyForReview = card.columnId === "ready_for_review";
	const isStory = card.type === "story";

	const commentEntries: CommentEntry[] = useMemo(() => {
		if (!isStory) {
			return (card.reviewComments ?? []).map((c) => ({ comment: c }));
		}
		const storyEntries: CommentEntry[] = (card.reviewComments ?? [])
			.filter((c) => c.type !== "dev")
			.map((c) => ({ comment: c }));
		const subtaskEntries: CommentEntry[] = (card.dependsOn ?? []).flatMap((depId) => {
			const dep = allCards?.[depId];
			if (!dep) return [];
			return (dep.reviewComments ?? []).map((c) => ({ comment: c, sourceCardTitle: dep.title }));
		});
		return [...storyEntries, ...subtaskEntries].sort((a, b) => a.comment.createdAt - b.comment.createdAt);
	}, [isStory, card.reviewComments, card.dependsOn, allCards]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "instant" });
	}, [commentEntries.length]);

	const addImageFiles = (files: FileList | File[]) => {
		for (const file of Array.from(files)) {
			if (!file.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const dataUrl = ev.target?.result as string;
				setPendingAttachments((prev) => [...prev, { dataUrl, file, name: file.name || "image.png" }]);
			};
			reader.readAsDataURL(file);
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
				await trpc.cards.submitHumanFeedback.mutate({
					workspaceId,
					cardId: card.id,
					comment: text || undefined,
					attachments,
				});
			} else {
				await trpc.cards.addReviewComment.mutate({
					workspaceId,
					cardId: card.id,
					type: "human",
					actor: { type: "human", id: "human" },
					summary: text || (uploaded.length > 0 ? `${uploaded.map((a) => a.name).join(", ")}` : ""),
					attachments,
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
		<div className="flex-1 min-h-0 flex flex-col bg-gray-950">
			{/* Messages */}
			<div className="flex-1 overflow-y-auto py-4">
				{commentEntries.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-gray-600">No comments yet</p>
					</div>
				) : (
					<>
						{commentEntries.map((entry, i) => {
							const { comment, sourceCardTitle } = entry;
							const prev = commentEntries[i - 1];
							const showDate = i === 0 || (prev != null && isDifferentDay(prev.comment.createdAt, comment.createdAt));
							const showHeader = i === 0 || (prev != null && !isSameGroup(prev, entry));
							const name = displayName(comment, workflowSlots);

							return (
								<div key={i}>
									{showDate && (
										<div className="flex items-center gap-3 px-4 my-3">
											<div className="flex-1 h-px bg-gray-800" />
											<span className="text-[11px] text-gray-500 font-medium shrink-0">
												{formatDateLabel(comment.createdAt)}
											</span>
											<div className="flex-1 h-px bg-gray-800" />
										</div>
									)}

									<div className={`group flex items-start gap-3 px-4 hover:bg-gray-900/40 ${showHeader ? "mt-3 pb-0.5" : "py-0.5"}`}>
										{/* Avatar column — always reserve space */}
										<div className="w-8 shrink-0 mt-0.5">
											{showHeader ? <Avatar comment={comment} /> : (
												<span className="block w-8 text-center text-[8px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums whitespace-nowrap pt-1">
													{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
											)}
										</div>

										<div className="flex-1 min-w-0">
											{showHeader && (
												<div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
													<span className="font-semibold text-sm text-gray-100">{name}</span>
													<AgentBadge comment={comment} />
													<span className="text-xs text-gray-600 tabular-nums">
														{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</span>
													{sourceCardTitle && (
														<span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-gray-500 bg-gray-800 truncate max-w-[160px]" title={sourceCardTitle}>
															{sourceCardTitle}
														</span>
													)}
												</div>
											)}
											<div className="prose-chat text-sm text-gray-300 leading-relaxed [overflow-wrap:anywhere]">
												<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
													{comment.summary.trimEnd()}
												</ReactMarkdown>
											</div>

											{/* Issues */}
											{comment.issues && comment.issues.length > 0 && (
												<details className="mt-1">
													<summary className="text-[11px] text-gray-500 cursor-pointer">
														{comment.issues.length} issue{comment.issues.length !== 1 ? "s" : ""}
													</summary>
													<ul className="mt-1 space-y-0.5">
														{comment.issues.map((issue, idx) => (
															<li key={idx} className="text-[11px] font-mono text-gray-400">
																<span className={SEVERITY_COLOR[issue.severity] ?? "text-gray-400"}>[{issue.severity}]</span>
																{" "}
																{issue.file}{issue.line != null ? `:${issue.line}` : ""}{issue.file ? " — " : ""}{issue.message}
															</li>
														))}
													</ul>
												</details>
											)}

											{/* Attachments */}
											{comment.attachments && comment.attachments.length > 0 && (
												<div className="mt-1 flex flex-wrap gap-2">
													{comment.attachments.map((att, idx) => (
														<AttachmentImage
															key={idx}
															path={att.path}
															name={att.name}
														/>
													))}
												</div>
											)}
										</div>
									</div>
								</div>
							);
						})}
						<div ref={bottomRef} />
					</>
				)}
			</div>

			{/* Input */}
			<div className="shrink-0 border-t border-gray-800 p-3">
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={(e) => { if (e.target.files) addImageFiles(e.target.files); e.target.value = ""; }}
				/>
				<div className="rounded-lg border border-gray-700 bg-gray-900 focus-within:border-gray-600 transition-colors">
					{/* Pending attachment previews */}
					{pendingAttachments.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-2">
							{pendingAttachments.map((att, idx) => (
								<div key={idx} className="relative group">
									<img
										src={att.dataUrl}
										alt={att.name}
										className="h-16 w-16 object-cover rounded border border-gray-700"
										title={att.name}
									/>
									<button
										onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== idx))}
										className="absolute -top-1 -right-1 size-4 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
							if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
						}}
						onPaste={(e) => {
							if (e.clipboardData.files.length > 0) {
								const hasImage = Array.from(e.clipboardData.files).some((f) => f.type.startsWith("image/"));
								if (hasImage) {
									e.preventDefault();
									addImageFiles(e.clipboardData.files);
								}
							}
						}}
						onDrop={(e) => {
							e.preventDefault();
							if (e.dataTransfer.files.length > 0) addImageFiles(e.dataTransfer.files);
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
								className="text-gray-600 hover:text-gray-400 transition-colors"
								title="Attach image"
								type="button"
							>
								<ImagePlus size={14} />
							</button>
							<span className="text-[10px] text-gray-700">↵ Send · ⇧↵ Newline</span>
						</div>
						<div className="flex gap-1.5">
							{isReadyForReview && (
								<Button variant="outlined" size="sm" disabled={sending} onClick={() => void send(true)}>
									{message.trim() || pendingAttachments.length > 0 ? "Request Changes" : "Reopen"}
								</Button>
							)}
							<Button size="sm" disabled={sending || (!message.trim() && pendingAttachments.length === 0)} onClick={() => void send()}>
								<Send size={11} className="mr-1" />
								Send
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
