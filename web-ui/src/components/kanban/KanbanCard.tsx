import { Draggable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard } from "@runtime-contract";
import { Bot, ExternalLink, FolderOpen, GitPullRequest, Link2, Pencil, RotateCcw, Trash2, Workflow, Zap } from "lucide-react";
import { trpc } from "@/runtime/trpc-client";

interface KanbanCardProps {
	card: RuntimeBoardCard;
	index: number;
	allCards: Record<string, RuntimeBoardCard>;
	workflowName?: string;
	onClick: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	onToggleReady?: () => void;
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

export function KanbanCard({ card, index, allCards, workflowName, onClick, onEdit, onDelete, onToggleReady }: KanbanCardProps) {
	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const agentLabel = card.agentId ? AGENT_LABELS[card.agentId] : null;
	const lastTs = card.terminalSessions?.at(-1);
	const sessionState = isRunning ? "running" : lastTs?.state;
	const sessionColor = sessionState ? (SESSION_STATE_COLORS[sessionState] ?? "text-gray-400") : null;

	const deps = card.dependsOn ?? [];
	const metDeps = deps.filter((id) => {
		const col = allCards[id]?.columnId;
		return col === "ready_for_review" || col === "done";
	});
	const allDepsMet = deps.length > 0 && metDeps.length === deps.length;

	return (
		<Draggable draggableId={card.id} index={index}>
			{(provided, snapshot) => (
				<div
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
					onClick={onClick}
					className={`
						relative group bg-gray-800 border rounded-lg p-3 cursor-pointer select-none
						transition-all duration-150 hover:bg-gray-750 hover:border-gray-500
						${snapshot.isDragging ? "border-blue-500 shadow-lg shadow-blue-500/20 rotate-1" : card.columnId === "todo" && card.readyForDev ? "border-emerald-500/50" : "border-gray-700"}
					`}
				>
					{/* Hover action buttons */}
					<div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5 z-10">
						{card.worktreePath && (
							<button
								onClick={(e) => { e.stopPropagation(); trpc.fs.openPath.mutate({ path: card.worktreePath! }); }}
								className="p-1 rounded text-gray-500 hover:text-blue-400 hover:bg-gray-700 transition-colors"
								title="Open worktree folder"
							>
								<FolderOpen size={11} />
							</button>
						)}
						{card.columnId === "todo" && onToggleReady && (
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
								title="Edit task"
							>
								<Pencil size={11} />
							</button>
						)}
						{onDelete && (
							<button
								onClick={(e) => { e.stopPropagation(); onDelete(); }}
								className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
								title="Delete task"
							>
								<Trash2 size={11} />
							</button>
						)}
					</div>

					<div className="flex items-start justify-between gap-2">
						<p className="text-sm text-gray-100 font-medium leading-snug flex-1 pr-10">{card.title}</p>
						<div className="flex items-center gap-1 shrink-0">
							{isRunning && <span className="mt-0.5 size-2 rounded-full bg-blue-400 animate-pulse" />}
						</div>
					</div>

					{card.description && <p className="mt-1.5 text-xs text-gray-400 line-clamp-2">{card.description}</p>}

					<div className="mt-2.5 flex items-center gap-2 flex-wrap">
						{card.columnId === "todo" && card.readyForDev && (
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
						{deps.length > 0 && (
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
							<span className="flex items-center gap-1 text-xs text-purple-400 bg-purple-400/10 rounded px-1.5 py-0.5">
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
