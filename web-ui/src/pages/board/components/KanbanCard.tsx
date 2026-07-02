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
import { AGENT_DISPLAY } from "../constants";
import { isCardRunning } from "../helpers";

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

const PRIORITY_STYLES: Record<string, string> = {
	urgent: "text-[#ff3b4d] bg-[#ff3b4d]/10",
	high: "text-[#f97316] bg-[#f97316]/10",
	medium: "text-[#eab308] bg-[#eab308]/10",
	low: "text-whip-faint bg-whip-faint/10",
};

const SESSION_STATE_COLORS: Record<string, string> = {
	running: "text-whip-text",
	completed: "text-[#22c55e]",
	failed: "text-[#ff3b4d]",
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
	const isRunning = isCardRunning(card);
	const lastTs = card.terminalSessions?.at(-1);
	const sessionState = isRunning ? "running" : lastTs?.state;
	const sessionColor = sessionState ? (SESSION_STATE_COLORS[sessionState] ?? "text-whip-muted") : null;
	const isStory = card.type === "story";
	const isSubtask = card.type === "subtask";
	const lastActivity = card.activityLog?.at(-1)?.message;

	const deps = card.dependsOn ? [card.dependsOn] : (card.waitsFor ?? []);
	const metDeps = deps.filter((id) => {
		const col = allCards[id]?.columnId;
		return col === "ready_for_review" || col === "done";
	});
	const allDepsMet = deps.length > 0 && metDeps.length === deps.length;

	// A story tracks progress over its subtasks (not dependsOn/waitsFor).
	const subtaskIds = card.subtaskIds ?? [];
	const metSubtasks = subtaskIds.filter((id) => {
		const col = allCards[id]?.columnId;
		return col === "ready_for_review" || col === "done";
	});
	// A subtask links back to the story that owns it.
	const parentStory = isSubtask
		? Object.values(allCards).find((c) => c.type === "story" && c.subtaskIds?.includes(card.id))
		: undefined;

	const borderClass = (snapshot_isDragging: boolean) => {
		if (snapshot_isDragging) return "border-whip-text shadow-lg shadow-black/40 rotate-1";
		if (isStory) return "border-[#8b5cf6]/60";
		if (
			(card.columnId === "in_progress" || card.columnId === "reopened" || card.columnId === "ready_for_review") &&
			isRunning
		) {
			return "border-whip-text shadow-[0_0_10px_rgba(255,255,255,0.15)]";
		}
		if (card.columnId === "todo" && card.readyForDev) return "border-[#22c55e]/50";
		return "border-whip-border";
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
						isStory ? "bg-[#8b5cf6]/10 hover:border-[#8b5cf6]/60" : "bg-whip-panel hover:border-whip-border-hover",
						borderClass(snapshot.isDragging),
					)}
				>
					<div onClick={onClick} className="p-3 cursor-pointer">
						{/* Story header */}
						{isStory && (
							<div className="flex items-center gap-1.5 mb-2">
								<Layers size={11} className="text-[#8b5cf6] shrink-0" />
								<span className="text-[10px] font-semibold text-[#8b5cf6] uppercase tracking-wide">Story</span>
							</div>
						)}

						<div className="flex items-start justify-between gap-2">
							<p
								className={classNames(
									"text-sm font-medium leading-snug flex-1",
									isStory ? "text-whip-text" : "text-whip-text",
								)}
							>
								{card.description?.split("\n")[0] ?? card.id}
							</p>
							<div className="flex items-center gap-1 shrink-0">
								{isRunning && <span className="mt-0.5 size-2 rounded-full bg-whip-text animate-pulse" />}
							</div>
						</div>

						{card.description?.includes("\n") && (
							<p className="mt-1.5 text-xs text-whip-muted line-clamp-2">
								{card.description.split("\n").slice(1).join("\n").trim()}
							</p>
						)}

						{/* Why a card is stuck — surfaced from the latest activity entry */}
						{card.columnId === "blocked" && lastActivity && (
							<div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded bg-[#ff3b4d]/10 border border-[#ff3b4d]/30">
								<AlertTriangle size={11} className="text-[#ff3b4d] shrink-0 mt-px" />
								<span className="text-[11px] text-[#ff9aa4] leading-snug line-clamp-2">{lastActivity}</span>
							</div>
						)}
						{card.columnId === "ready_for_review" && lastActivity?.startsWith("Delivery pending") && (
							<div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded bg-[#eab308]/10 border border-[#eab308]/30">
								<Clock size={11} className="text-[#eab308] shrink-0 mt-px" />
								<span className="text-[11px] text-[#eab308]/90 leading-snug line-clamp-2">{lastActivity}</span>
							</div>
						)}

						{/* Story progress bar — driven by its subtasks */}
						{isStory && subtaskIds.length > 0 && (
							<div className="mt-2.5">
								<div className="flex items-center justify-between mb-1">
									<span className="text-[10px] text-whip-faint">
										{subtaskIds.length} subtask{subtaskIds.length === 1 ? "" : "s"}
									</span>
									<span className="text-[10px] text-whip-muted">
										{metSubtasks.length}/{subtaskIds.length}
									</span>
								</div>
								<div className="h-1 bg-whip-border rounded-full overflow-hidden">
									<div
										className="h-full bg-[#8b5cf6] rounded-full transition-all"
										style={{ width: `${(metSubtasks.length / subtaskIds.length) * 100}%` }}
									/>
								</div>
							</div>
						)}

						<div className="mt-2.5 flex items-center gap-2 flex-wrap">
							{isSubtask && (
								<span
									title={parentStory ? `Subtask of: ${parentStory.description?.split("\n")[0]}` : "Subtask"}
									className="flex items-center gap-1 text-[10px] text-whip-faint bg-whip-border rounded px-1.5 py-0.5 font-medium max-w-[180px]"
								>
									<Layers size={10} className="shrink-0 text-[#8b5cf6]/70" />
									<span className="truncate">{parentStory?.description?.split("\n")[0] ?? "subtask"}</span>
								</span>
							)}
							{!isStory && card.columnId === "todo" && card.readyForDev && (
								<span className="flex items-center gap-1 text-xs text-[#22c55e] bg-[#22c55e]/10 rounded px-1.5 py-0.5 font-medium">
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
										allDepsMet ? "text-whip-muted bg-whip-border" : "text-[#f97316] bg-[#f97316]/10",
									)}
								>
									<Link2 size={10} />
									{metDeps.length}/{deps.length}
								</span>
							)}
							{card.agentId &&
								(() => {
									const ac = AGENT_DISPLAY[card.agentId!] ?? {
										dotColor: "bg-whip-faint",
										color: "text-whip-muted",
										bg: "bg-whip-faint/10",
									};
									return (
										<span
											className={classNames(
												"flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full",
												ac.bg,
												ac.color,
											)}
										>
											<span className={classNames("size-[5px] rounded-full", ac.dotColor)} />
											{card.agentId}
										</span>
									);
								})()}
							{workflowName && (
								<span className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 text-[#8b5cf6] bg-[#8b5cf6]/10">
									<Workflow size={10} />
									{workflowName}
								</span>
							)}
							{card.autoFixAttempts > 0 && (
								<span className="flex items-center gap-1 text-xs text-[#f97316] bg-[#f97316]/10 rounded px-1.5 py-0.5">
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
									className="flex items-center gap-1 text-xs text-[#22c55e] bg-[#22c55e]/10 rounded px-1.5 py-0.5 hover:bg-[#22c55e]/20"
								>
									<GitPullRequest size={10} />
									PR
									<ExternalLink size={8} />
								</a>
							)}
							{card.baseRef && (
								<span
									className="flex items-center gap-1 text-[10px] text-whip-faint bg-whip-border/30 rounded px-1.5 py-0.5 font-mono"
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
								<GitBranch size={9} className="text-whip-faint shrink-0" />
								<span className="text-[10px] text-whip-faint font-mono truncate">{card.branchName}</span>
							</div>
						)}
					</div>
					{/* Action bar — hidden by default, visible on group-hover */}
					<div
						className="px-3 pb-2 border-t border-whip-border flex items-center gap-0.5 pt-1.5"
						onClick={(e) => e.stopPropagation()}
					>
						{isRunningNow ? (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onStop?.();
								}}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-[#ff3b4d] hover:bg-whip-border-soft transition-colors cursor-pointer"
								title="Stop running"
							>
								<Square size={13} className="fill-current" />
								Stop
							</button>
						) : onRun ? (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onRun();
								}}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-whip-muted hover:text-[#22c55e] hover:bg-whip-border-soft transition-colors cursor-pointer"
								title="Run ticket"
							>
								<Play size={13} />
								Run
							</button>
						) : null}
						{card.columnId === "todo" && onToggleReady && !isStory && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onToggleReady();
								}}
								className={classNames(
									"flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer",
									card.readyForDev
										? "text-[#22c55e] hover:text-whip-muted hover:bg-whip-border-soft"
										: "text-whip-muted hover:text-[#22c55e] hover:bg-whip-border-soft",
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
								className="px-2.5 py-1.5 rounded text-xs text-whip-muted hover:text-whip-text hover:bg-whip-border-soft transition-colors cursor-pointer"
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
								className="px-2.5 py-1.5 rounded text-xs text-whip-muted hover:text-whip-text hover:bg-whip-border-soft transition-colors cursor-pointer"
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
								className="px-2.5 py-1.5 rounded text-xs text-whip-muted hover:text-[#ff3b4d] hover:bg-whip-border-soft transition-colors cursor-pointer"
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
