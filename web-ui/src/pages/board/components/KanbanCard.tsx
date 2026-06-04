import { Draggable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import {
	AlertTriangle,
	Clock,
	ExternalLink,
	FolderOpen,
	GitBranch,
	GitPullRequest,
	Layers,
	Link2,
	Pencil,
	Play,
	RotateCcw,
	Square,
	Trash2,
	Workflow,
	Zap,
} from "lucide-react";
import { useWrite } from "@/runtime/api-client";

interface KanbanCardProps {
	card: RuntimeBoardCard;
	index: number;
	allCards: Record<string, RuntimeBoardCard>;
	workflowName?: string;
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

const AGENT_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
	claude: { dot: "bg-[#7c6aff]", text: "text-[#7c6aff]", bg: "bg-[#7c6aff]/10" },
	codex: { dot: "bg-[#22c55e]", text: "text-[#22c55e]", bg: "bg-[#22c55e]/10" },
	cursor: { dot: "bg-[#3b82f6]", text: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10" },
	opencode: { dot: "bg-[#f97316]", text: "text-[#f97316]", bg: "bg-[#f97316]/10" },
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

export function KanbanCard({
	card,
	index,
	allCards,
	workflowName,
	isRunning: isRunningNow,
	onClick,
	onEdit,
	onDelete,
	onToggleReady,
	onRun,
	onStop,
}: KanbanCardProps) {
	const { trigger: openPath } = useWrite((api) => api("fs/open").POST());
	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const _agentLabel = card.agentId ? AGENT_LABELS[card.agentId] : null;
	const lastTs = card.terminalSessions?.at(-1);
	const sessionState = isRunning ? "running" : lastTs?.state;
	const sessionColor = sessionState ? (SESSION_STATE_COLORS[sessionState] ?? "text-gray-400") : null;
	const isStory = card.type === "story";
	const isSubtask = card.type === "subtask";
	const lastActivity = card.activityLog?.at(-1)?.message;

	const deps = card.dependsOn ? [card.dependsOn] : (card.waitsFor ?? []);
	const metDeps = deps.filter((id) => {
		const col = allCards[id]?.columnId;
		return col === "ready_for_review" || col === "done";
	});
	const allDepsMet = deps.length > 0 && metDeps.length === deps.length;

	const borderClass = (snapshot_isDragging: boolean) => {
		if (snapshot_isDragging) return "border-blue-500 shadow-lg shadow-blue-500/20 rotate-1";
		if (isStory) return "border-purple-800";
		if (
			(card.columnId === "in_progress" || card.columnId === "reopened" || card.columnId === "ready_for_review") &&
			isRunning
		) {
			return "border-[#3b82f6] shadow-[0_0_10px_rgba(59,130,246,0.15)]";
		}
		if (card.columnId === "todo" && card.readyForDev) return "border-emerald-500/50";
		return "border-[#2a2a35]";
	};

	return (
		<Draggable draggableId={card.id} index={index}>
			{(provided, snapshot) => (
				<div
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
					className={classNames(
						"border rounded-lg overflow-hidden select-none transition-all duration-150 group",
						isStory ? "bg-purple-950/30 hover:border-purple-700" : "bg-[#1a1a1f] hover:border-gray-600",
						borderClass(snapshot.isDragging),
					)}
				>
					<div onClick={onClick} className="p-3 cursor-pointer">
						{/* Story header */}
						{isStory && (
							<div className="flex items-center gap-1.5 mb-2">
								<Layers size={11} className="text-purple-400 shrink-0" />
								<span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Story</span>
							</div>
						)}

						<div className="flex items-start justify-between gap-2">
							<p
								className={classNames(
									"text-sm font-medium leading-snug flex-1",
									isStory ? "text-purple-100" : "text-gray-100",
								)}
							>
								{card.description?.split("\n")[0] ?? card.id}
							</p>
							<div className="flex items-center gap-1 shrink-0">
								{isRunning && <span className="mt-0.5 size-2 rounded-full bg-blue-400 animate-pulse" />}
							</div>
						</div>

						{card.description?.includes("\n") && (
							<p className="mt-1.5 text-xs text-gray-400 line-clamp-2">
								{card.description.split("\n").slice(1).join("\n").trim()}
							</p>
						)}

						{/* Why a card is stuck — surfaced from the latest activity entry */}
						{card.columnId === "blocked" && lastActivity && (
							<div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30">
								<AlertTriangle size={11} className="text-red-400 shrink-0 mt-px" />
								<span className="text-[11px] text-red-300/90 leading-snug line-clamp-2">{lastActivity}</span>
							</div>
						)}
						{card.columnId === "ready_for_review" && lastActivity?.startsWith("Delivery pending") && (
							<div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30">
								<Clock size={11} className="text-amber-400 shrink-0 mt-px" />
								<span className="text-[11px] text-amber-300/90 leading-snug line-clamp-2">{lastActivity}</span>
							</div>
						)}

						{/* Story progress bar */}
						{isStory && deps.length > 0 && (
							<div className="mt-2.5">
								<div className="flex items-center justify-between mb-1">
									<span className="text-[10px] text-gray-500">Progress</span>
									<span className="text-[10px] text-gray-400">
										{metDeps.length}/{deps.length}
									</span>
								</div>
								<div className="h-1 bg-[#2a2a35] rounded-full overflow-hidden">
									<div
										className="h-full bg-purple-500 rounded-full transition-all"
										style={{ width: `${deps.length > 0 ? (metDeps.length / deps.length) * 100 : 0}%` }}
									/>
								</div>
							</div>
						)}

						<div className="mt-2.5 flex items-center gap-2 flex-wrap">
							{isSubtask && (
								<span className="text-[10px] text-gray-500 bg-[#2a2a35] rounded px-1.5 py-0.5 font-medium">
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
								<span
									className={classNames("text-xs rounded px-1.5 py-0.5 font-medium", PRIORITY_STYLES[card.priority])}
								>
									{card.priority}
								</span>
							)}
							{!isStory && deps.length > 0 && (
								<span
									className={classNames(
										"flex items-center gap-1 text-xs rounded px-1.5 py-0.5 font-medium",
										allDepsMet ? "text-[#8888a0] bg-[#2a2a35]" : "text-orange-400 bg-orange-400/10",
									)}
								>
									<Link2 size={10} />
									{metDeps.length}/{deps.length}
								</span>
							)}
							{card.agentId &&
								(() => {
									const ac = AGENT_COLORS[card.agentId!] ?? {
										dot: "bg-gray-500",
										text: "text-gray-400",
										bg: "bg-gray-500/10",
									};
									return (
										<span
											className={classNames(
												"flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full",
												ac.bg,
												ac.text,
											)}
										>
											<span className={classNames("size-[5px] rounded-full", ac.dot)} />
											{card.agentId}
										</span>
									);
								})()}
							{workflowName && (
								<span className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 text-purple-400 bg-purple-400/10">
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
							{card.pr?.url && (
								<a
									href={card.pr?.url}
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
							{card.baseRef && (
								<span
									className="flex items-center gap-1 text-[10px] text-gray-600 bg-gray-700/30 rounded px-1.5 py-0.5 font-mono"
									title={`Base branch: ${card.baseRef}`}
								>
									<GitBranch size={9} />
									{card.baseRef}
								</span>
							)}
							{isRunning && card.columnId !== "done" && (
								<span className={classNames("text-xs ml-auto", sessionColor)}>running</span>
							)}
						</div>
						{card.branchName && (
							<div className="mt-1.5 flex items-center gap-1">
								<GitBranch size={9} className="text-gray-600 shrink-0" />
								<span className="text-[10px] text-gray-600 font-mono truncate">{card.branchName}</span>
							</div>
						)}
					</div>
					{/* Action bar — hidden by default, visible on group-hover */}
					<div
						className="px-3 pb-2 border-t border-[#2a2a35] flex items-center gap-0.5 pt-1.5"
						onClick={(e) => e.stopPropagation()}
					>
						{isRunningNow ? (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onStop?.();
								}}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-red-400 hover:bg-[#252530] transition-colors cursor-pointer"
								title="Stop running"
							>
								<Square size={13} className="fill-current" />
								Stop
							</button>
						) : (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onRun?.();
								}}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-emerald-400 hover:bg-[#252530] transition-colors cursor-pointer"
								title="Run ticket"
							>
								<Play size={13} />
								Run
							</button>
						)}
						{card.columnId === "todo" && onToggleReady && !isStory && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onToggleReady();
								}}
								className={classNames(
									"flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer",
									card.readyForDev
										? "text-emerald-400 hover:text-gray-400 hover:bg-[#252530]"
										: "text-gray-500 hover:text-emerald-400 hover:bg-[#252530]",
								)}
								title={card.readyForDev ? "Unmark as ready" : "Mark as ready for agent"}
							>
								<Zap size={13} />
							</button>
						)}
						{card.worktreePath && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									void openPath({ body: { path: card.worktreePath! } });
								}}
								className="px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-blue-400 hover:bg-[#252530] transition-colors cursor-pointer"
								title="Open worktree folder"
							>
								<FolderOpen size={13} />
							</button>
						)}
						<div className="flex-1" />
						{!isRunning && onEdit && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onEdit();
								}}
								className="px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-gray-200 hover:bg-[#252530] transition-colors cursor-pointer"
								title={isStory ? "Edit story" : "Edit task"}
							>
								<Pencil size={13} />
							</button>
						)}
						{onDelete && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onDelete();
								}}
								className="px-2.5 py-1.5 rounded text-xs text-gray-500 hover:text-red-400 hover:bg-[#252530] transition-colors cursor-pointer"
								title="Delete"
							>
								<Trash2 size={13} />
							</button>
						)}
					</div>
				</div>
			)}
		</Draggable>
	);
}
