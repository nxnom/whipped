import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "@runtime-contract";
import { ArrowLeft, ExternalLink, Play, Square, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	session?: RuntimeTaskSessionSummary;
	onClose: () => void;
	onRefresh: () => void;
}

const SESSION_STATE_LABEL: Record<string, string> = {
	running: "Running",
	review_in_progress: "Review in progress",
	awaiting_review: "Awaiting review",
	failed: "Failed",
	completed: "Completed",
	idle: "Idle",
};

const SESSION_TYPE_LABEL: Record<string, string> = {
	dev: "Dev",
	"code-review": "Code Review",
	qa: "QA",
};

export function CardDetailPanel({ card, workspaceId, session, onClose, onRefresh }: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);

	// Reset to latest session when a different card is opened
	const prevCardIdRef = useRef(card.id);
	useEffect(() => {
		if (card.id !== prevCardIdRef.current) {
			prevCardIdRef.current = card.id;
			setActiveStreamId(card.terminalSessions?.at(-1)?.streamId ?? card.id);
			prevSessionLenRef.current = card.terminalSessions?.length ?? 0;
		}
	}, [card.id]);

	// Auto-switch to the newest session whenever a new one is appended
	const prevSessionLenRef = useRef(card.terminalSessions?.length ?? 0);
	useEffect(() => {
		const sessions = card.terminalSessions ?? [];
		if (sessions.length > prevSessionLenRef.current) {
			const latest = sessions.at(-1);
			if (latest) setActiveStreamId(latest.streamId);
		}
		prevSessionLenRef.current = sessions.length;
	}, [card.terminalSessions?.length]);

	const isRunning = session?.state === "running" || session?.state === "review_in_progress";
	// Show the terminal if there's any session history recorded, regardless of current
	// session state — this keeps terminals visible after restarts or stop/start cycles.
	const hasTerminalOutput =
		(card.terminalSessions?.length ?? 0) > 0 ||
		(session &&
			(session.state === "running" ||
				session.state === "review_in_progress" ||
				session.state === "awaiting_review" ||
				session.state === "failed"));

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
					onClose();
					onRefresh();
				} catch {
					toast.error("Failed to delete task");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return (
		<div className="absolute inset-0 z-10 bg-gray-950 flex overflow-hidden">
			{/* ── Left sidebar: task info ─────────────────────────── */}
			<div className="w-72 shrink-0 border-r border-gray-800 flex flex-col">
				{/* Header */}
				<div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800">
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
						title="Back to board"
					>
						<ArrowLeft size={16} />
					</button>
					<span className="text-xs text-gray-500 truncate flex-1">{card.title}</span>
				</div>

				{/* Task details */}
				<div className="flex-1 overflow-y-auto p-4 space-y-4">
					{/* Title + status */}
					<div>
						<h2 className="text-sm font-semibold text-gray-100 leading-snug">{card.title}</h2>
						{session && session.state !== "idle" && (
							<div className="flex items-center gap-1.5 mt-1">
								<span
									className={`size-1.5 rounded-full ${
										session.state === "running"
											? "bg-blue-400 animate-pulse"
											: session.state === "review_in_progress"
												? "bg-purple-400 animate-pulse"
												: session.state === "awaiting_review"
													? "bg-yellow-400"
													: session.state === "failed"
														? "bg-red-400"
														: "bg-gray-500"
									}`}
								/>
								<span className="text-xs text-gray-500">
									{session.agentId} · {SESSION_STATE_LABEL[session.state] ?? session.state}
								</span>
							</div>
						)}
					</div>

					{/* Description */}
					{card.description && (
						<p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{card.description}</p>
					)}

					{/* Links */}
					{(card.githubIssueUrl || card.githubPrUrl || card.jiraUrl) && (
						<div className="space-y-1.5">
							{card.githubIssueUrl && (
								<a
									href={card.githubIssueUrl}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
								>
									<ExternalLink size={11} /> GitHub Issue
								</a>
							)}
							{card.githubPrUrl && (
								<a
									href={card.githubPrUrl}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300"
								>
									<ExternalLink size={11} /> Pull Request
								</a>
							)}
							{card.jiraUrl && (
								<a
									href={card.jiraUrl}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300"
								>
									<ExternalLink size={11} /> {card.jiraKey}
								</a>
							)}
						</div>
					)}

					{/* Sessions */}
					{card.terminalSessions && card.terminalSessions.length > 0 && (
						<div>
							<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sessions</h4>
							<div className="space-y-0.5">
								{card.terminalSessions.map((ts) => (
									<button
										key={ts.streamId}
										onClick={() => setActiveStreamId(ts.streamId)}
										className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
											activeStreamId === ts.streamId
												? "bg-gray-800 text-gray-100"
												: "text-gray-400 hover:text-gray-300 hover:bg-gray-800/50"
										}`}
									>
										<TerminalSquare size={11} className="shrink-0 text-gray-500" />
										<span className="flex-1">{SESSION_TYPE_LABEL[ts.type] ?? ts.type}</span>
										<span className="text-gray-600 tabular-nums">
											{new Date(ts.startedAt).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</button>
								))}
							</div>
						</div>
					)}

					{/* Activity log */}
					{card.activityLog && card.activityLog.length > 0 && (
						<div>
							<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Activity</h4>
							<div className="space-y-1.5">
								{[...card.activityLog].reverse().map((entry, i) => (
									<div key={i} className="flex items-baseline gap-2 text-xs">
										<span className="text-gray-600 shrink-0 tabular-nums">
											{new Date(entry.timestamp).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
												second: "2-digit",
											})}
										</span>
										<span className="text-gray-400">{entry.message}</span>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Review feedback */}
					{card.reviewComments && card.reviewComments.length > 0 && (
						<div>
							<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Review Feedback</h4>
							<div className="space-y-2">
								{card.reviewComments.map((comment, i) => (
									<div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs">
										<p className="text-gray-500 mb-1.5">
											{comment.type === "code_review" ? "Code Review" : "QA"} · {comment.agent}
										</p>
										<p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{comment.content}</p>
									</div>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Footer actions */}
				<div className="border-t border-gray-800 p-3 flex items-center justify-between gap-2">
					<Button variant="ghost" size="sm" onClick={handleDelete}>
						<Trash2 size={13} className="mr-1 text-gray-500" /> Delete
					</Button>
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

			{/* ── Terminal ─────────────────────────────────────────── */}
			<div className="flex-1 min-w-0 flex flex-col bg-[#030712]">
				{hasTerminalOutput ? (
					<TaskTerminal
						key={activeStreamId}
						taskId={activeStreamId}
						workspaceId={workspaceId}
						className="flex-1"
					/>
				) : (
					<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-600">
						<span className="text-4xl">⌨</span>
						<p className="text-sm">No agent output yet</p>
						<p className="text-xs">Start the agent to see terminal output here</p>
					</div>
				)}
			</div>
		</div>
	);
}
