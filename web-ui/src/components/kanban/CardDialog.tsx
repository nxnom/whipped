import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "@runtime-contract";
import { ExternalLink, Play, Square, X } from "lucide-react";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	session?: RuntimeTaskSessionSummary;
	onClose: () => void;
	onRefresh: () => void;
}

export function CardDialog({ card, workspaceId, session, onClose, onRefresh }: Props) {
	const isRunning = session?.state === "running" || session?.state === "review_in_progress";

	const handleStart = async () => {
		try {
			await trpc.cards.startAgent.mutate({ workspaceId, cardId: card.id });
			onRefresh();
		} catch {
			toast.error("Failed to start agent");
		}
	};

	const handleStop = async () => {
		try {
			await trpc.cards.stopAgent.mutate({ workspaceId, cardId: card.id });
			onRefresh();
		} catch {
			toast.error("Failed to stop agent");
		}
	};

	const handleDelete = () => {
		ConfirmDialog.show({
			title: "Delete task?",
			content: "This cannot be undone.",
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					await trpc.cards.delete.mutate({ workspaceId, cardId: card.id });
					dismiss();
					onRefresh();
				} catch {
					toast.error("Failed to delete task");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-lg max-h-[80vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-3 mb-3">
					<h3 className="text-base font-semibold text-gray-100">{card.title}</h3>
					<button onClick={onClose} className="text-gray-500 hover:text-gray-300 shrink-0 mt-0.5">
						<X size={16} />
					</button>
				</div>

				{card.description && <p className="text-sm text-gray-300 whitespace-pre-wrap mb-4">{card.description}</p>}

				{/* Links */}
				<div className="flex flex-wrap gap-3 mb-4">
					{card.githubIssueUrl && (
						<a
							href={card.githubIssueUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
						>
							<ExternalLink size={11} /> GitHub Issue
						</a>
					)}
					{card.githubPrUrl && (
						<a
							href={card.githubPrUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 text-xs text-green-400 hover:underline"
						>
							<ExternalLink size={11} /> Pull Request
						</a>
					)}
					{card.jiraUrl && (
						<a
							href={card.jiraUrl}
							target="_blank"
							rel="noreferrer"
							className="flex items-center gap-1 text-xs text-purple-400 hover:underline"
						>
							<ExternalLink size={11} /> {card.jiraKey}
						</a>
					)}
				</div>

				{/* Session */}
				{session && (
					<div className="bg-gray-800 rounded-lg p-3 mb-4 text-xs space-y-1">
						<div className="flex justify-between text-gray-400">
							<span>
								Status: <span className="text-gray-200">{session.state.replace(/_/g, " ")}</span>
							</span>
							<span>
								Agent: <span className="text-gray-200">{session.agentId}</span>
							</span>
						</div>
						{session.lastOutput && (
							<pre className="text-gray-400 text-xs overflow-x-auto whitespace-pre-wrap mt-2">{session.lastOutput}</pre>
						)}
					</div>
				)}

				{/* Activity log */}
				{card.activityLog && card.activityLog.length > 0 && (
					<div className="space-y-1 mb-4">
						<h4 className="text-xs font-medium text-gray-400 mb-1.5">Activity</h4>
						<div className="bg-gray-800 rounded-lg p-2.5 space-y-1 max-h-40 overflow-y-auto">
							{card.activityLog.map((entry, i) => (
								<div key={i} className="flex items-baseline gap-2 text-xs">
									<span className="text-gray-600 shrink-0 tabular-nums">
										{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
									</span>
									<span className="text-gray-300">{entry.message}</span>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Review comments */}
				{card.reviewComments && card.reviewComments.length > 0 && (
					<div className="space-y-2 mb-4">
						<h4 className="text-xs font-medium text-gray-400">Review Feedback</h4>
						{card.reviewComments.map((comment, i) => (
							<div key={i} className="bg-gray-800 rounded-lg p-3 text-xs">
								<p className="text-gray-500 mb-1">
									{comment.type === "code_review" ? "Code Review" : "QA"} · {comment.agent}
								</p>
								<p className="text-gray-300 whitespace-pre-wrap">{comment.content}</p>
							</div>
						))}
					</div>
				)}

				<div className="flex items-center justify-between">
					<Button variant="ghost" color="primary" size="sm" onClick={handleDelete}>
						Delete
					</Button>
					<div className="flex gap-2">
						{isRunning ? (
							<Button variant="outlined" size="sm" onClick={handleStop}>
								<Square size={12} className="mr-1" /> Stop
							</Button>
						) : (
							<Button size="sm" onClick={handleStart}>
								<Play size={12} className="mr-1" /> Start Agent
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
