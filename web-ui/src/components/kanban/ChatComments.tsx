import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeReviewComment, WorkflowSlot } from "@runtime-contract";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { trpc } from "@/runtime/trpc-client";

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ agent, type }: { agent: string; type: string }) {
	const [err, setErr] = useState(false);
	const seed = `${type}-${agent}`;

	if (err) {
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-700 text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{agent.slice(0, 2).toUpperCase()}
			</div>
		);
	}

	return (
		<img
			src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`}
			alt={agent}
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

function displayName(agent: string, type: string, source: string | undefined, slots?: WorkflowSlot[]): string {
	if (source) return agent;
	if (type === "human") return "You";
	if (TYPE_LABELS[type]) return TYPE_LABELS[type]!;
	const slot = slots?.find((s) => s.id === type);
	if (slot) return slot.name;
	return type.charAt(0).toUpperCase() + type.slice(1);
}

const TYPE_STYLE: Record<string, string> = {
	dev: "text-blue-400 bg-blue-400/10",
	code_review: "text-purple-400 bg-purple-400/10",
	qa: "text-cyan-400 bg-cyan-400/10",
};

function AgentBadge({ agent, type, source, passed }: { agent: string; type: string; source?: string; passed?: boolean }) {
	if (source) {
		const label = source.charAt(0).toUpperCase() + source.slice(1);
		return (
			<span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium text-gray-400 bg-gray-700/50">
				{label}
			</span>
		);
	}
	if (type === "human") return null;
	const className = TYPE_STYLE[type] ?? "text-gray-400 bg-gray-700/50";
	return (
		<span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${className}`}>
			{agent}
			{passed === true && <span className="text-green-400">✓</span>}
			{passed === false && <span className="text-red-400">✗</span>}
		</span>
	);
}

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

function isSameGroup(a: RuntimeReviewComment, b: RuntimeReviewComment): boolean {
	return a.agent === b.agent && a.type === b.type && a.source === b.source && b.createdAt - a.createdAt < 5 * 60 * 1000;
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
	workflowSlots?: WorkflowSlot[];
	onRefresh: () => void;
}

export function ChatComments({ card, workspaceId, workflowSlots, onRefresh }: Props) {
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isReadyForReview = card.columnId === "ready_for_review";
	const comments = card.reviewComments ?? [];

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "instant" });
	}, [comments.length]);

	const send = async (requestChanges = false) => {
		const text = message.trim();
		if (!requestChanges && !text) return;
		setSending(true);
		try {
			if (requestChanges) {
				await trpc.cards.submitHumanFeedback.mutate({ workspaceId, cardId: card.id, comment: text || undefined });
			} else {
				await trpc.cards.addReviewComment.mutate({ workspaceId, cardId: card.id, content: text, type: "human", agent: "human" });
			}
			setMessage("");
			onRefresh();
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="flex-1 min-h-0 flex flex-col bg-gray-950">
			{/* Messages */}
			<div className="flex-1 overflow-y-auto py-4">
				{comments.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-gray-600">No comments yet</p>
					</div>
				) : (
					<>
						{comments.map((comment, i) => {
							const prev = comments[i - 1];
							const showDate = i === 0 || (prev != null && isDifferentDay(prev.createdAt, comment.createdAt));
							const showHeader = i === 0 || (prev != null && !isSameGroup(prev, comment));
							const name = displayName(comment.agent, comment.type, comment.source, workflowSlots);

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
											{showHeader ? <Avatar agent={comment.agent} type={comment.type} /> : (
												<span className="block w-8 text-center text-[8px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums whitespace-nowrap pt-1">
													{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
											)}
										</div>

										<div className="flex-1 min-w-0">
											{showHeader && (
												<div className="flex items-baseline gap-2 mb-0.5">
													<span className="font-semibold text-sm text-gray-100">{name}</span>
													<AgentBadge agent={comment.agent} type={comment.type} source={comment.source} passed={comment.passed} />
													<span className="text-xs text-gray-600 tabular-nums">
														{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</span>
												</div>
											)}
											<div className="prose-chat text-sm text-gray-300 leading-relaxed [overflow-wrap:anywhere]">
												<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
													{comment.content.trimEnd()}
												</ReactMarkdown>
											</div>
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
				<div className="rounded-lg border border-gray-700 bg-gray-900 focus-within:border-gray-600 transition-colors">
					<textarea
						ref={textareaRef}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
						}}
						placeholder="Add a comment…"
						rows={2}
						className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-1 resize-none outline-none placeholder-gray-600"
					/>
					<div className="flex items-center justify-between px-3 pb-2">
						<span className="text-[10px] text-gray-700">↵ Send · ⇧↵ Newline</span>
						<div className="flex gap-1.5">
							{isReadyForReview && (
								<Button variant="outlined" size="sm" disabled={sending} onClick={() => void send(true)}>
									{message.trim() ? "Request Changes" : "Reopen"}
								</Button>
							)}
							<Button size="sm" disabled={sending || !message.trim()} onClick={() => void send()}>
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
