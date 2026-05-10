import { Draggable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard } from "@runtime-contract";
import { Bot, ExternalLink, FolderOpen, GitPullRequest, Layers, Link2, Pencil, Play, RotateCcw, Square, Trash2, Workflow, Zap } from "lucide-react";
import { trpc } from "@/runtime/trpc-client";

interface KanbanCardProps {
	card: RuntimeBoardCard;
	index: number;
	allCards: Record<string, RuntimeBoardCard>;
	workflowName?: string;
	workspaceId: string;
	isRunning: boolean;
	onClick: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onToggleReady?: () => void;
	onRun?: () => void;
	onStop?: () => void;
}

const AGENT_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
};

const PRIORITY_STYLES: Record<string, string> = {
	urgent: "text-red-400 bg-red-400/10",
	high: "text-orange-400 bg-orange-400/10",
	medium: "text-yellow-400 bg-yellow-400/10",
	low: "text-slate-400 bg-slate-400/10",
};

const SESSION_STATE_COLORS: Record<string, string> = {
	running: "text-blue-400",
	completed: "text-green-400",
	failed: "text-red-400",
};

export function KanbanCard({ card, index, allCards, workflowName, workspaceId: _workspaceId, isRunning: isRunningNow, onClick, onEdit, onDelete, onToggleReady, onRun, onStop }: KanbanCardProps) {
	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const agentLabel = card.agentId ? AGENT_LABELS[card.agentId] : null;
	const lastTs = card.terminalSessions?.at(-1);
	const sessionState = isRunning ? "running" : lastTs?.state;
	const sessionColor = sessionState ? (SESSION_STATE_COLORS[sessionState] ?? "text-gray-400") : null;
	const isStory = card.type === "story";
	const isSubtask = card.type === "subtask";

	const deps = card.dependsOn ?? [];
	const metDeps = deps.filter((id) => {
		const col = allCards[id]?.columnId;
		return col === "ready_for_review" || col === "done";
	});
	const allDepsMet = deps.length > 0 && metDeps.length === deps.length;

	const borderClass = snapshot_isDragging => {
		if (snapshot_isDragging) return "border-blue-500 shadow-lg shadow-blue-500/20 rotate-1";
		if (isStory) return "border-purple-800";
		if (card.columnId === "todo" && card.readyForDev) return "border-emerald-500/50";
		return "border-gray-700";
	};

	return (
		<Draggable draggableId={card.id} index={index}>
			{(provided, snapshot) => (
				<div
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
					onClick={onClick}
					className={`
						relative group border rounded-lg p-3 cursor-pointer select-none
						transition-all duration-150
						${isStory ? "bg-purple-950/30 hover:bg-purple-950/50 hover:border-purple-700" : "bg-gray-800 hover:bg-gray-750 hover:border-gray-500"}
						${borderClass(snapshot.isDragging)}
					`}
				>
					{/* Hover action buttons */}
					<div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5 z-10">
						{isRunningNow ? (
							<button
								onClick={(e) => { e.stopPropagation(); onStop?.(); }}
								className="p-1 rounded text-red-400 hover:bg-gray-700 transition-colors"
								title="Stop running"
							>
								<Square size={11} className="fill-current" />
							</button>
						) : (
							<button
								onClick={(e) => { e.stopPropagation(); onRun?.(); }}
								className="p-1 rounded text-gray-500 hover:text-emerald-400 hover:bg-gray-700 transition-colors"
								title="Run ticket"
							>
								<Play size={11} />
							</button>
						)}
						{card.worktreePath && (
							<button
								onClick={(e) => { e.stopPropagation(); trpc.fs.openPath.mutate({ path: card.worktreePath! }); }}
								className="p-1 rounded text-gray-500 hover:text-blue-400 hover:bg-gray-700 transition-colors"
								title="Open worktree folder"
							>
								<FolderOpen size={11} />
							</button>
						)}
						{card.columnId === "todo" && onToggleReady && !isStory && !isSubtask && (
							<button
								onClick={(e) => { e.stopPropagation(); onToggleReady(); }}
								className={`p-1 rounded transition-colors ${card.readyForDev ? "text-emerald-400 hover:text-gray-400 hover:bg-gray-700" : "text-gray-500 hover:text-emerald-400 hover:bg-gray-700"}`}
								title={card.readyForDev ? "Unmark as ready" : "Mark as ready for agent"}
							>
								<Zap size={11} />
							</button>
						)}
						{!isRunning && onEdit && (
							<button
								onClick={(e) => { e.stopPropagation(); onEdit(); }}
								className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
								title={isStory ? "Edit story" : "Edit task"}
							>
								<Pencil size={11} />
							</button>
						)}
						{onDelete && (
							<button
								onClick={(e) => { e.stopPropagation(); onDelete(); }}
								className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
								title="Delete"
							>
								<Trash2 size={11} />
							</button>
						)}
					</div>

					{/* Story header */}
					{isStory && (
						<div className="flex items-center gap-1.5 mb-2">
							<Layers size={11} className="text-purple-400 shrink-0" />
							<span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Story</span>
						</div>
					)}

					<div className="flex items-start justify-between gap-2">
						<p className={`text-sm font-medium leading-snug flex-1 pr-10 ${isStory ? "text-purple-100" : "text-gray-100"}`}>
							{card.title}
						</p>
						<div className="flex items-center gap-1 shrink-0">
							{isRunning && <span className="mt-0.5 size-2 rounded-full bg-blue-400 animate-pulse" />}
						</div>
					</div>

					{card.description && <p className="mt-1.5 text-xs text-gray-400 line-clamp-2">{card.description}</p>}

					{/* Story progress bar */}
					{isStory && deps.length > 0 && (
						<div className="mt-2.5">
							<div className="flex items-center justify-between mb-1">
								<span className="text-[10px] text-gray-500">Progress</span>
								<span className="text-[10px] text-gray-400">{metDeps.length}/{deps.length}</span>
							</div>
							<div className="h-1 bg-gray-700 rounded-full overflow-hidden">
								<div
									className="h-full bg-purple-500 rounded-full transition-all"
									style={{ width: `${deps.length > 0 ? (metDeps.length / deps.length) * 100 : 0}%` }}
								/>
							</div>
						</div>
					)}

					<div className="mt-2.5 flex items-center gap-2 flex-wrap">
						{isSubtask && (
							<span className="text-[10px] text-gray-500 bg-gray-700/50 rounded px-1.5 py-0.5 font-medium">
								subtask
							</span>
						)}
						{!isStory && card.columnId === "todo" && card.readyForDev && (
							<span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-400/10 rounded px-1.5 py-0.5 font-medium">
								<Zap size={10} />
								Ready
							</span>
						)}
						{card.priority && (
							<span className={`text-xs rounded px-1.5 py-0.5 font-medium ${PRIORITY_STYLES[card.priority]}`}>
								{card.priority}
							</span>
						)}
						{!isStory && deps.length > 0 && (
							<span className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 font-medium ${allDepsMet ? "text-gray-400 bg-gray-700" : "text-orange-400 bg-orange-400/10"}`}>
								<Link2 size={10} />
								{metDeps.length}/{deps.length}
							</span>
						)}
						{agentLabel && (
							<span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-700 rounded px-1.5 py-0.5">
								<Bot size={10} />
								{agentLabel}
							</span>
						)}
						{workflowName && (
							<span className={`flex items-center gap-1 text-xs rounded px-1.5 py-0.5 ${isStory ? "text-purple-400 bg-purple-400/10" : "text-purple-400 bg-purple-400/10"}`}>
								<Workflow size={10} />
								{workflowName}
							</span>
						)}
						{card.autoFixAttempts > 0 && (
							<span className="flex items-center gap-1 text-xs text-orange-400 bg-orange-400/10 rounded px-1.5 py-0.5">
								<RotateCcw size={10} />
								{card.autoFixAttempts}x
							</span>
						)}
						{card.githubPrUrl && (
							<a
								href={card.githubPrUrl}
								target="_blank"
								rel="noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="flex items-center gap-1 text-xs text-green-400 bg-green-400/10 rounded px-1.5 py-0.5 hover:bg-green-400/20"
							>
								<GitPullRequest size={10} />
								PR
								<ExternalLink size={8} />
							</a>
						)}
						{card.jiraKey && (
							<a
								href={card.jiraUrl}
								target="_blank"
								rel="noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="text-xs text-blue-400 bg-blue-400/10 rounded px-1.5 py-0.5 hover:bg-blue-400/20"
							>
								{card.jiraKey}
							</a>
						)}
						{isRunning && card.columnId !== "done" && (
							<span className={`text-xs ml-auto ${sessionColor}`}>running</span>
						)}
					</div>
				</div>
			)}
		</Draggable>
	);
}
