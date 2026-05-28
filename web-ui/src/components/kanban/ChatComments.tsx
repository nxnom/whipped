import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeReviewComment, WorkflowSlot } from "@runtime-contract";
import { Paperclip, Send, X } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
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
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#2a2a38] text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{initials}
			</div>
		);
	}

	const seed = `${type}-${actor.id}`;

	if (err) {
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#2a2a38] text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{actor.id.slice(0, 2).toUpperCase()}
			</div>
		);
	}

	return (
		<img
			src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`}
			alt={actor.id}
			className="w-8 h-8 rounded-full shrink-0 bg-[#1a1a24]"
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
	"visual-comment": "Visual Feedback",
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
		<span
			className={classNames("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium", className)}
		>
			{actor.id}
			{status === "pass" && <span className="text-green-400">✓</span>}
			{status === "fail" && <span className="text-red-400">✗</span>}
			{status === "warning" && <span className="text-yellow-400">⚠</span>}
			{status === "skipped" && <span className="text-gray-400">—</span>}
		</span>
	);
}

// ── Attachment image ──────────────────────────────────────────────────────────

function AttachmentItem({ path, name, mimeType }: { path: string; name: string; mimeType?: string }) {
	const [expanded, setExpanded] = useState(false);
	const isImage = (mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
	if (isImage) {
		return (
			<div className="mt-1">
				<img
					src={attachmentUrl(path)}
					alt={name}
					className={classNames(
						"rounded border border-[#2a2a38] cursor-pointer object-contain",
						expanded ? "max-w-full max-h-96" : "max-h-24 max-w-48",
					)}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Click to collapse" : "Click to expand"}
				/>
				<div className="text-[10px] text-[#4a4a5a] mt-0.5">{name}</div>
			</div>
		);
	}
	return (
		<a
			href={attachmentUrl(path)}
			target="_blank"
			rel="noreferrer"
			className="mt-1 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-[#2a2a38] bg-[#1a1a24] text-xs text-gray-300 hover:text-gray-100 hover:border-[#3a3a50] transition-colors max-w-[200px]"
			title={name}
		>
			<Paperclip size={11} className="shrink-0" />
			<span className="truncate">{name}</span>
		</a>
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

function makeMdComponents(): React.ComponentProps<typeof ReactMarkdown>["components"] {
	return {
		p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
		strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
		em: ({ children }) => <em className="italic">{children}</em>,
		code: ({ children, className }) => {
			const isBlock = className?.includes("language-");
			return isBlock ? (
				<code className="block bg-[#1a1a24] border border-[#2a2a38] rounded px-3 py-2 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre my-1">
					{children}
				</code>
			) : (
				<code className="bg-[#1a1a24] border border-[#2a2a38] rounded px-1 py-0.5 text-xs font-mono text-gray-200">
					{children}
				</code>
			);
		},
		pre: ({ children }) => <pre className="my-1 overflow-x-auto">{children}</pre>,
		ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
		ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
		li: ({ children }) => <li className="text-gray-300">{children}</li>,
		blockquote: ({ children }) => (
			<blockquote className="border-l-2 border-[#3a3a50] pl-3 my-1 text-gray-400 italic">{children}</blockquote>
		),
		a: ({ href, children }) => (
			<a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
				{children}
			</a>
		),
		h1: ({ children }) => <h1 className="text-base font-semibold text-gray-100 mt-2 mb-1">{children}</h1>,
		h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-100 mt-2 mb-1">{children}</h2>,
		h3: ({ children }) => <h3 className="text-sm font-medium text-gray-200 mt-1 mb-0.5">{children}</h3>,
		hr: () => <hr className="border-[#2a2a38] my-2" />,
		img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full max-h-64 rounded my-1 object-contain" />,
	};
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	onRefresh: () => void;
}

interface PendingAttachment {
	dataUrl: string | null; // local preview for images; null for non-image files
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
			return (dep.reviewComments ?? []).map((c) => ({
				comment: c,
				sourceCardTitle: dep.description?.split("\n")[0] ?? dep.id,
			}));
		});
		return [...storyEntries, ...subtaskEntries].sort((a, b) => a.comment.createdAt - b.comment.createdAt);
	}, [isStory, card.reviewComments, card.dependsOn, allCards]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "instant" });
	}, [commentEntries.length]);

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
		<div className="flex-1 min-h-0 flex flex-col bg-[#0a0a0e]">
			{/* Messages */}
			<div className="flex-1 overflow-y-auto py-4">
				{commentEntries.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-[#4a4a5a]">No comments yet</p>
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
											<div className="flex-1 h-px bg-[#1e1e28]" />
											<span className="text-[11px] text-[#4a4a5a] font-medium shrink-0">
												{formatDateLabel(comment.createdAt)}
											</span>
											<div className="flex-1 h-px bg-[#1e1e28]" />
										</div>
									)}

									<div
										className={classNames(
											"group flex items-start gap-3 px-4 hover:bg-[#13131a]",
											showHeader ? "mt-3 pb-0.5" : "py-0.5",
										)}
									>
										{/* Avatar column — always reserve space */}
										<div className="w-8 shrink-0 mt-0.5">
											{showHeader ? (
												<Avatar comment={comment} />
											) : (
												<span className="block w-8 text-center text-[8px] text-[#3a3a4a] opacity-0 group-hover:opacity-100 transition-opacity tabular-nums whitespace-nowrap pt-1">
													{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
											)}
										</div>

										<div className="flex-1 min-w-0">
											{showHeader && (
												<div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
													<span className="font-semibold text-sm text-gray-100">{name}</span>
													<AgentBadge comment={comment} />
													<span className="text-xs text-[#4a4a5a] tabular-nums">
														{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</span>
													{sourceCardTitle && (
														<span
															className="text-[10px] px-1.5 py-0.5 rounded font-medium text-[#6a6a80] bg-[#1a1a24] border border-[#2a2a38] truncate max-w-[160px]"
															title={sourceCardTitle}
														>
															{sourceCardTitle}
														</span>
													)}
												</div>
											)}
											<div className="prose-chat text-sm text-gray-300 leading-relaxed [overflow-wrap:anywhere]">
												<ReactMarkdown
													remarkPlugins={[remarkGfm]}
													rehypePlugins={[rehypeRaw]}
													components={makeMdComponents()}
												>
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
																<span className={SEVERITY_COLOR[issue.severity] ?? "text-gray-400"}>
																	[{issue.severity}]
																</span>{" "}
																{issue.file}
																{issue.line != null ? `:${issue.line}` : ""}
																{issue.file ? " — " : ""}
																{issue.message}
															</li>
														))}
													</ul>
												</details>
											)}

											{/* Visual comment metadata */}
											{comment.type === "visual-comment" && !!comment.metadata?.visualComment && (() => {
												const vc = comment.metadata!.visualComment as {
													pageUrl?: string;
													elementSelector?: string;
													elementText?: string;
													componentName?: string;
													sourceFile?: string;
													sourceLine?: number;
												};
												const shortFile = vc.sourceFile?.split("/").slice(-2).join("/");
												return (
													<div className="mt-1.5 flex flex-col gap-1 px-2 py-1.5 rounded bg-[#7c6aff]/8 border border-[#7c6aff]/20 text-[11px] text-[#8888a0]">
														<div className="flex items-center gap-1.5 flex-wrap">
															<span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-[#a78bfa] bg-[#7c6aff]/15">Visual</span>
															{vc.elementSelector && (
																<code className="font-mono text-[#c4baff]">{vc.elementSelector}</code>
															)}
															{vc.componentName && (
																<span className="text-[#6a6a80]">⚛ {vc.componentName}</span>
															)}
														</div>
														{vc.elementText && (
															<div className="text-[#a0a0b8] italic line-clamp-2">"{vc.elementText}"</div>
														)}
														{vc.pageUrl && (
															<a
																href={vc.pageUrl}
																target="_blank"
																rel="noreferrer"
																className="truncate text-[#4a4a5a] hover:text-[#8888a0] transition-colors"
															>
																{vc.pageUrl}
															</a>
														)}
														{shortFile && (
															<span className="font-mono text-[#4a4a5a]">
																{shortFile}{vc.sourceLine != null ? `:${vc.sourceLine}` : ""}
															</span>
														)}
													</div>
												);
											})()}

											{/* Attachments */}
											{comment.attachments &&
												comment.attachments.length > 0 &&
												(() => {
													const isImg = (att: { mimeType?: string; name: string }) =>
														(att.mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
													const images = comment.attachments.filter(isImg);
													const files = comment.attachments.filter((a) => !isImg(a));
													return (
														<div className="mt-1 space-y-1.5">
															{images.length > 0 && (
																<div className="flex flex-wrap gap-2">
																	{images.map((att, idx) => (
																		<AttachmentItem key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
																	))}
																</div>
															)}
															{files.length > 0 && (
																<div className="flex flex-wrap gap-1.5">
																	{files.map((att, idx) => (
																		<AttachmentItem key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
																	))}
																</div>
															)}
														</div>
													);
												})()}
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
		</div>
	);
}
