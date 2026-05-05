import { Button, ConfirmDialog, Select, SelectOption, Textarea, Tooltip, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, RuntimeCardPriority, RuntimeTaskSessionSummary } from "@runtime-contract";
import { ArrowLeft, ExternalLink, FolderOpen, GitMerge, GitPullRequest, Link2, Play, Square, TerminalSquare, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	session?: RuntimeTaskSessionSummary;
	allCards?: Record<string, RuntimeBoardCard>;
	onClose: () => void;
	onRefresh: () => void;
}

const PRIORITY_STYLES: Record<string, string> = {
	urgent: "text-red-400 bg-red-400/10 border-red-400/20",
	high: "text-orange-400 bg-orange-400/10 border-orange-400/20",
	medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
	low: "text-slate-400 bg-slate-400/10 border-slate-400/20",
};

const COLUMN_LABELS: Record<string, string> = {
	todo: "Todo",
	ready_for_dev: "Ready",
	in_progress: "In Progress",
	in_review: "In Review",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

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
	conflict: "Conflict",
};

const MIN_SIDEBAR = 340;
const MAX_SIDEBAR = 520;
const DEFAULT_SIDEBAR = 340;

type SidebarTab = "overview" | "comments" | "activity";

export function CardDetailPanel({ card, workspaceId, session, allCards, onClose, onRefresh }: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);
	const [feedback, setFeedback] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [merging, setMerging] = useState(false);
	const [creatingPR, setCreatingPR] = useState(false);
	const [addingDep, setAddingDep] = useState(false);
	const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
	const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const commentsEndRef = useRef<HTMLDivElement>(null);
	const commentsScrollRef = useRef<HTMLDivElement>(null);

	const isReadyForReview = card.columnId === "ready_for_review";
	const commentCount = card.reviewComments?.length ?? 0;

	// ── Auto-scroll comments to bottom ────────────────────────────────────
	useEffect(() => {
		if (activeTab === "comments") {
			commentsEndRef.current?.scrollIntoView({ behavior: "instant" });
		}
	}, [activeTab, commentCount]);

	// ── Resize drag handle ─────────────────────────────────────────────────
	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragRef.current) return;
			setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, dragRef.current.startWidth + e.clientX - dragRef.current.startX)));
		};
		const onMouseUp = () => { dragRef.current = null; };
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	const onDragStart = (e: React.MouseEvent) => {
		dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
		e.preventDefault();
	};

	// ── Session tracking ───────────────────────────────────────────────────
	const prevCardIdRef = useRef(card.id);
	useEffect(() => {
		if (card.id !== prevCardIdRef.current) {
			prevCardIdRef.current = card.id;
			setActiveStreamId(card.terminalSessions?.at(-1)?.streamId ?? card.id);
			prevSessionLenRef.current = card.terminalSessions?.length ?? 0;
		}
	}, [card.id]);

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
	const hasTerminalOutput =
		(card.terminalSessions?.length ?? 0) > 0 ||
		(session &&
			(session.state === "running" ||
				session.state === "review_in_progress" ||
				session.state === "awaiting_review" ||
				session.state === "failed"));

	// ── Handlers ───────────────────────────────────────────────────────────
	const handleSubmitFeedback = async () => {
		if (!feedback.trim()) return;
		setSubmitting(true);
		try {
			await trpc.cards.submitHumanFeedback.mutate({ workspaceId, cardId: card.id, comment: feedback.trim() });
			toast.success("Feedback submitted — card moved to Reopened");
			setFeedback("");
			onRefresh();
		} catch {
			toast.error("Failed to submit feedback");
		} finally {
			setSubmitting(false);
		}
	};

	const handleStart = async () => {
		try {
			await trpc.cards.startAgent.mutate({ workspaceId, cardId: card.id });
			onRefresh();
		} catch {
			toast.error("Failed to start agent");
		}
	};

	const handleStop = () => {
		ConfirmDialog.show({
			title: "Stop agent?",
			content: "The agent will be interrupted. You can restart it later.",
			confirmButtonLabel: "Stop",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					await trpc.cards.stopAgent.mutate({ workspaceId, cardId: card.id });
					dismiss();
					onRefresh();
				} catch {
					toast.error("Failed to stop agent");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCommitAndMerge = () => {
		ConfirmDialog.show({
			title: `Merge into ${card.baseRef}?`,
			content: "Commits any pending changes and merges the task branch directly. This cannot be undone.",
			confirmButtonLabel: "Merge",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				setMerging(true);
				try {
					const result = await trpc.cards.commitAndMerge.mutate({ workspaceId, cardId: card.id });
					if (result.status === "merged") {
						toast.success(`Merged into ${card.baseRef}`);
						onRefresh();
						onClose();
					} else {
						toast.success("Merge conflicts detected — resolving with AI agent...");
						onRefresh();
					}
				} catch (err: unknown) {
					toast.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setMerging(false);
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCommitAndPR = () => {
		ConfirmDialog.show({
			title: "Create Pull Request?",
			content: `Commits any pending changes, pushes the branch, and opens a PR against ${card.baseRef}.`,
			confirmButtonLabel: "Create PR",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				setCreatingPR(true);
				try {
					const result = await trpc.cards.commitAndPR.mutate({ workspaceId, cardId: card.id });
					toast.success("PR created");
					window.open(result.prUrl, "_blank");
					onRefresh();
				} catch (err: unknown) {
					toast.error(`PR creation failed: ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setCreatingPR(false);
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
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

	const handlePriorityChange = async (value: string) => {
		try {
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				priority: value as RuntimeCardPriority || undefined,
				revision: 0,
			});
			onRefresh();
		} catch {
			toast.error("Failed to update priority");
		}
	};

	const handleAddDep = async (depId: string) => {
		if (!depId || (card.dependsOn ?? []).includes(depId)) return;
		setAddingDep(false);
		try {
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				dependsOn: [...(card.dependsOn ?? []), depId],
				revision: 0,
			});
			onRefresh();
		} catch {
			toast.error("Failed to add dependency");
		}
	};

	const handleRemoveDep = async (depId: string) => {
		try {
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				dependsOn: (card.dependsOn ?? []).filter((id) => id !== depId),
				revision: 0,
			});
			onRefresh();
		} catch {
			toast.error("Failed to remove dependency");
		}
	};

	return (
		<div className="absolute inset-0 z-10 bg-gray-950 flex overflow-hidden">
			{/* ── Sidebar ──────────────────────────────────────────────── */}
			<div
				className="shrink-0 border-r border-gray-800 flex flex-col"
				style={{ width: sidebarWidth }}
			>
				{/* Header */}
				<div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800 shrink-0">
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
						title="Back to board"
					>
						<ArrowLeft size={16} />
					</button>
					<span className="text-xs text-gray-400 truncate flex-1 font-medium">{card.title}</span>
					{session && session.state !== "idle" && (
						<span
							className={`size-1.5 rounded-full shrink-0 ${
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
					)}
				</div>

				{/* Tab bar */}
				<div className="flex border-b border-gray-800 shrink-0">
					{(["overview", "comments", "activity"] as SidebarTab[]).map((tab) => (
						<button
							key={tab}
							onClick={() => setActiveTab(tab)}
							className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
								activeTab === tab ? "text-gray-100" : "text-gray-500 hover:text-gray-300"
							}`}
						>
							{tab === "comments" && commentCount > 0
								? `Comments (${commentCount})`
								: tab.charAt(0).toUpperCase() + tab.slice(1)}
							{activeTab === tab && (
								<span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />
							)}
						</button>
					))}
				</div>

				{/* Tab content */}
				<div className="flex-1 min-h-0 flex flex-col">
					{/* ── Overview tab ── */}
					{activeTab === "overview" && (
						<div className="flex-1 overflow-y-auto p-4 space-y-4">
							<div>
								<h2 className="text-sm font-semibold text-gray-100 leading-snug">{card.title}</h2>
								{session && session.state !== "idle" && (
									<p className="text-xs text-gray-500 mt-1">
										{session.agentId} · {SESSION_STATE_LABEL[session.state] ?? session.state}
									</p>
								)}
								{session?.worktreePath && (
									<button
										onClick={() => trpc.fs.openPath.mutate({ path: session.worktreePath! })}
										className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 transition-colors"
									>
										<FolderOpen size={12} />
										<span className="font-mono truncate max-w-[220px]">{session.worktreePath.split("/").slice(-2).join("/")}</span>
									</button>
								)}
							</div>

							{card.description && (
								<p className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">{card.description}</p>
							)}

							{/* Priority */}
							<div>
								<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Priority</h4>
								<Select
									value={card.priority ?? ""}
									onChange={(v) => handlePriorityChange(v as string)}
									placeholder="No priority"
									clearable
								>
									<SelectOption value="urgent" label="Urgent" />
									<SelectOption value="high" label="High" />
									<SelectOption value="medium" label="Medium" />
									<SelectOption value="low" label="Low" />
								</Select>
							</div>

							{/* Dependencies */}
							<div>
								<div className="flex items-center justify-between mb-1.5">
									<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Dependencies</h4>
									{!addingDep && (
										<button
											onClick={() => setAddingDep(true)}
											className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
										>
											+ Add
										</button>
									)}
								</div>
								{(card.dependsOn ?? []).length === 0 && !addingDep && (
									<p className="text-xs text-gray-600">None</p>
								)}
								<div className="space-y-1">
									{(card.dependsOn ?? []).map((depId) => {
										const dep = allCards?.[depId];
										const isMet = dep?.columnId === "ready_for_review" || dep?.columnId === "done";
										return (
											<div key={depId} className="flex items-center gap-1.5 text-xs">
												<Link2 size={11} className={isMet ? "text-green-500" : "text-orange-400"} />
												<span className="flex-1 text-gray-300 truncate">
													{dep?.title ?? depId}
												</span>
												{dep && (
													<span className={`text-[10px] px-1.5 py-0.5 rounded ${isMet ? "bg-green-500/15 text-green-400" : "bg-orange-400/10 text-orange-400"}`}>
														{COLUMN_LABELS[dep.columnId] ?? dep.columnId}
													</span>
												)}
												<button
													onClick={() => handleRemoveDep(depId)}
													className="text-gray-600 hover:text-red-400 transition-colors ml-0.5"
												>
													<X size={11} />
												</button>
											</div>
										);
									})}
								</div>
								{addingDep && allCards && (
									<div className="mt-1.5">
										<Select
											value=""
											onChange={(v) => handleAddDep(v as string)}
											placeholder="Search cards..."
											filterable
										>
											{Object.values(allCards)
												.filter((c) => c.id !== card.id && !(card.dependsOn ?? []).includes(c.id))
												.map((c) => (
													<SelectOption key={c.id} value={c.id} label={c.title} />
												))}
										</Select>
										<button
											onClick={() => setAddingDep(false)}
											className="text-xs text-gray-600 hover:text-gray-400 mt-1 transition-colors"
										>
											Cancel
										</button>
									</div>
								)}
							</div>

							{(card.githubIssueUrl || card.githubPrUrl || card.jiraUrl) && (
								<div className="space-y-1.5">
									{card.githubIssueUrl && (
										<a href={card.githubIssueUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
											<ExternalLink size={11} /> GitHub Issue
										</a>
									)}
									{card.githubPrUrl && (
										<a href={card.githubPrUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300">
											<ExternalLink size={11} /> Pull Request
										</a>
									)}
									{card.jiraUrl && (
										<a href={card.jiraUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300">
											<ExternalLink size={11} /> {card.jiraKey}
										</a>
									)}
								</div>
							)}

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
													{new Date(ts.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
											</button>
										))}
									</div>
								</div>
							)}
						</div>
					)}

					{/* ── Comments tab — chat layout: scrollable list + input pinned at bottom ── */}
					{activeTab === "comments" && (
						<div className="flex-1 min-h-0 flex flex-col">
							<div ref={commentsScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
								{commentCount === 0 ? (
									<p className="text-xs text-gray-600 text-center py-8">No comments yet</p>
								) : (
									card.reviewComments.map((comment, i) => (
										<div
											key={i}
											className={`border rounded-lg p-3 text-xs ${COMMENT_TYPE_COLOR[comment.type] ?? "border-gray-800 bg-gray-900"}`}
										>
											<div className="flex items-center justify-between mb-1.5 opacity-70">
												<span className="font-medium">{COMMENT_TYPE_LABEL[comment.type] ?? comment.type}</span>
												<span className="text-gray-500 tabular-nums">
													{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
											</div>
											{comment.agent !== "human" && (
												<p className="text-gray-500 text-[10px] mb-1.5">{comment.agent}</p>
											)}
											<p className="text-gray-300 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{comment.content}</p>
										</div>
									))
								)}
								{/* Scroll anchor */}
								<div ref={commentsEndRef} />
							</div>

							{/* Feedback input pinned at bottom */}
							{isReadyForReview && (
								<div className="shrink-0 border-t border-gray-800 p-3 bg-gray-900/40">
									<Textarea
										value={feedback}
										onChange={(e) => setFeedback(e.target.value)}
										placeholder="Request changes or give feedback…"
										rows={3}
										autoResize
									/>
									<Button
										size="sm"
										className="mt-2 w-full"
										onClick={handleSubmitFeedback}
										disabled={!feedback.trim() || submitting}
									>
										{submitting ? "Submitting…" : "Submit & Reopen"}
									</Button>
								</div>
							)}
						</div>
					)}

					{/* ── Activity tab ── */}
					{activeTab === "activity" && (
						<div className="flex-1 overflow-y-auto p-4">
							{!card.activityLog?.length ? (
								<p className="text-xs text-gray-600 text-center py-8">No activity yet</p>
							) : (
								<div className="space-y-1.5">
									{card.activityLog.map((entry, i) => (
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
							)}
						</div>
					)}
				</div>

				{/* Footer actions */}
				<div className="border-t border-gray-800 p-3 flex items-center justify-between gap-2 shrink-0">
					<Tooltip content="Delete this task permanently" side="top" triggerAsChild>
						<Button variant="ghost" size="sm" onClick={handleDelete}>
							<Trash2 size={13} className="mr-1 text-gray-500" /> Delete
						</Button>
					</Tooltip>

					{isReadyForReview ? (
						<div className="flex gap-1.5">
							<Tooltip content={`Commit & merge directly into ${card.baseRef}`} side="top" triggerAsChild>
								<Button variant="outlined" size="sm" onClick={handleCommitAndMerge} disabled={merging || creatingPR}>
									<GitMerge size={12} className="mr-1" />
									{merging ? "Merging..." : `→ ${card.baseRef}`}
								</Button>
							</Tooltip>
							{card.githubPrUrl ? (
								<Tooltip content="Open Pull Request" side="top" triggerAsChild>
									<a
										href={card.githubPrUrl}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 hover:border-green-500/50 transition-colors"
									>
										<GitPullRequest size={12} />
										View PR
										<ExternalLink size={10} />
									</a>
								</Tooltip>
							) : (
								<Tooltip content={`Push & open a PR against ${card.baseRef}`} side="top" triggerAsChild>
									<Button size="sm" onClick={handleCommitAndPR} disabled={merging || creatingPR}>
										<GitPullRequest size={12} className="mr-1" />
										{creatingPR ? "Creating..." : "PR"}
									</Button>
								</Tooltip>
							)}
						</div>
					) : isRunning ? (
						<Tooltip content="Interrupt the running agent" side="top" triggerAsChild>
							<Button variant="outlined" size="sm" onClick={handleStop}>
								<Square size={12} className="mr-1" /> Stop
							</Button>
						</Tooltip>
					) : (
						<Tooltip content="Start the AI agent on this task" side="top" triggerAsChild>
							<Button size="sm" onClick={handleStart}>
								<Play size={12} className="mr-1" /> Start Agent
							</Button>
						</Tooltip>
					)}
				</div>
			</div>

			{/* ── Drag handle ──────────────────────────────────────────── */}
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors bg-gray-800"
			/>

			{/* ── Terminal area ─────────────────────────────────────────── */}
			<div className="flex-1 min-w-0 flex flex-col bg-[#030712]">
				{card.terminalSessions && card.terminalSessions.length > 1 && (
					<div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-800 bg-gray-900/50 shrink-0 overflow-x-auto">
						{card.terminalSessions.map((ts) => (
							<button
								key={ts.streamId}
								onClick={() => setActiveStreamId(ts.streamId)}
								className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${
									activeStreamId === ts.streamId
										? "bg-gray-700 text-gray-100"
										: "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
								}`}
							>
								<TerminalSquare size={10} />
								{SESSION_TYPE_LABEL[ts.type] ?? ts.type}
								<span className="text-gray-600 tabular-nums">
									{new Date(ts.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
								</span>
							</button>
						))}
					</div>
				)}

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
