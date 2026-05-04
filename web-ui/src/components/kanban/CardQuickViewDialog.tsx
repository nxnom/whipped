import { Button, Textarea, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "@runtime-contract";
import { ExternalLink, Maximize2, X } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	session?: RuntimeTaskSessionSummary;
	onClose: () => void;
	onOpenDetail: () => void;
	onRefresh: () => void;
}

const COMMENT_TYPE_LABEL: Record<string, string> = {
	dev: "Dev Summary",
	code_review: "Code Review",
	qa: "QA",
	human: "Your Feedback",
};

const COMMENT_TYPE_COLOR: Record<string, string> = {
	dev: "text-blue-400 border-blue-900 bg-blue-950/30",
	code_review: "text-purple-400 border-purple-900 bg-purple-950/30",
	qa: "text-cyan-400 border-cyan-900 bg-cyan-950/30",
	human: "text-yellow-400 border-yellow-900 bg-yellow-950/30",
};

const COLUMN_LABELS: Record<string, string> = {
	todo: "Todo",
	ready_for_dev: "Ready for Dev",
	in_progress: "In Progress",
	in_review: "In Review",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

export function CardQuickViewDialog({ card, workspaceId, session, onClose, onOpenDetail, onRefresh }: Props) {
	const [feedback, setFeedback] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const isReadyForReview = card.columnId === "ready_for_review";

	const handleSubmitFeedback = async () => {
		if (!feedback.trim()) return;
		setSubmitting(true);
		try {
			await trpc.cards.submitHumanFeedback.mutate({ workspaceId, cardId: card.id, comment: feedback.trim() });
			toast.success("Feedback submitted — card moved to Reopened");
			onRefresh();
			onClose();
		} catch {
			toast.error("Failed to submit feedback");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-800">
					<div className="flex-1 min-w-0">
						<p className="text-xs text-gray-500 mb-1">{COLUMN_LABELS[card.columnId] ?? card.columnId}</p>
						<h2 className="text-base font-semibold text-gray-100 leading-snug">{card.title}</h2>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<button
							onClick={onOpenDetail}
							className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
							title="Open full detail"
						>
							<Maximize2 size={14} />
						</button>
						<button
							onClick={onClose}
							className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
						>
							<X size={14} />
						</button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
					{/* Description */}
					{card.description && (
						<p className="text-sm text-gray-400 whitespace-pre-wrap leading-relaxed">{card.description}</p>
					)}

					{/* Links */}
					{(card.githubIssueUrl || card.githubPrUrl || card.jiraUrl) && (
						<div className="flex flex-wrap gap-2">
							{card.githubIssueUrl && (
								<a href={card.githubIssueUrl} target="_blank" rel="noreferrer"
									className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
									<ExternalLink size={11} /> Issue
								</a>
							)}
							{card.githubPrUrl && (
								<a href={card.githubPrUrl} target="_blank" rel="noreferrer"
									className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300">
									<ExternalLink size={11} /> PR
								</a>
							)}
							{card.jiraUrl && (
								<a href={card.jiraUrl} target="_blank" rel="noreferrer"
									className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300">
									<ExternalLink size={11} /> {card.jiraKey}
								</a>
							)}
						</div>
					)}

					{/* Comments */}
					{card.reviewComments && card.reviewComments.length > 0 && (
						<div>
							<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Comments</h4>
							<div className="space-y-2">
								{card.reviewComments.map((c, i) => (
									<div key={i} className={`border rounded-lg p-3 text-xs ${COMMENT_TYPE_COLOR[c.type] ?? "border-gray-700 bg-gray-800"}`}>
										<p className="font-medium mb-1.5 opacity-70">
											{COMMENT_TYPE_LABEL[c.type] ?? c.type} · {c.agent}
										</p>
										<p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{c.content}</p>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Activity log — last 5 */}
					{card.activityLog && card.activityLog.length > 0 && (
						<div>
							<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent Activity</h4>
							<div className="space-y-1">
								{[...card.activityLog].reverse().slice(0, 5).map((entry, i) => (
									<div key={i} className="flex items-baseline gap-2 text-xs">
										<span className="text-gray-600 shrink-0 tabular-nums">
											{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
										</span>
										<span className="text-gray-400">{entry.message}</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Human feedback form — only when ready for review */}
					{isReadyForReview && (
						<div>
							<h4 className="text-xs font-medium text-yellow-500 uppercase tracking-wide mb-2">Request Changes</h4>
							<Textarea
								value={feedback}
								onChange={(e) => setFeedback(e.target.value)}
								placeholder="Describe what needs to be fixed or improved…"
								rows={3}
								autoResize
							/>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="border-t border-gray-800 px-5 py-3 flex items-center justify-between gap-2">
					<Button variant="ghost" size="sm" onClick={onOpenDetail}>
						<Maximize2 size={12} className="mr-1" /> Full Detail
					</Button>
					{isReadyForReview ? (
						<Button size="sm" onClick={handleSubmitFeedback} disabled={!feedback.trim() || submitting}>
							{submitting ? "Submitting…" : "Submit & Reopen"}
						</Button>
					) : (
						<Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
					)}
				</div>
			</div>
		</div>
	);
}
