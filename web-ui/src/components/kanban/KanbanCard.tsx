import { Draggable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeTaskSessionSummary } from "@runtime-contract";
import { Bot, ExternalLink, GitPullRequest, Pencil, RotateCcw, Trash2 } from "lucide-react";

interface KanbanCardProps {
	card: RuntimeBoardCard;
	index: number;
	session?: RuntimeTaskSessionSummary;
	onClick: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
}

const AGENT_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
};

const SESSION_STATE_COLORS: Record<string, string> = {
	running: "text-blue-400",
	awaiting_review: "text-yellow-400",
	review_in_progress: "text-purple-400",
	completed: "text-green-400",
	failed: "text-red-400",
};

export function KanbanCard({ card, index, session, onClick, onEdit, onDelete }: KanbanCardProps) {
	const isRunning = session?.state === "running" || session?.state === "review_in_progress";
	const agentLabel = card.agentId ? AGENT_LABELS[card.agentId] : null;
	const sessionColor = session ? (SESSION_STATE_COLORS[session.state] ?? "text-gray-400") : null;

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
						${snapshot.isDragging ? "border-blue-500 shadow-lg shadow-blue-500/20 rotate-1" : "border-gray-700"}
					`}
				>
					{/* Hover action buttons */}
					<div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5 z-10">
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
						{agentLabel && (
							<span className="flex items-center gap-1 text-xs text-gray-400 bg-gray-700 rounded px-1.5 py-0.5">
								<Bot size={10} />
								{agentLabel}
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

						{session && session.state !== "idle" && card.columnId !== "done" && (
							<span className={`text-xs ml-auto ${sessionColor}`}>{session.state.replace(/_/g, " ")}</span>
						)}
					</div>
				</div>
			)}
		</Draggable>
	);
}
