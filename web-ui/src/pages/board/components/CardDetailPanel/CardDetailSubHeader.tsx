import type { RuntimeBoardCard } from "@runtime-contract";
import { Clock, FolderOpen, GitBranch } from "lucide-react";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { AGENT_DISPLAY, COLUMN_STATUS, formatElapsed, PRIORITY_BADGE } from "./constants";

interface CardDetailSubHeaderProps {
	card: RuntimeBoardCard;
	agentId: string | null;
	isRunning: boolean;
	elapsedSec: number;
}

export function CardDetailSubHeader({ card, agentId, isRunning, elapsedSec }: CardDetailSubHeaderProps) {
	const { trigger: openTerminalTrigger } = useWrite((api) => api("fs/open-terminal").POST());
	const columnStatus = COLUMN_STATUS[card.columnId];
	const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null;
	const agentBadge = agentId ? (AGENT_DISPLAY[agentId] ?? null) : null;

	return (
		<div className="flex items-center gap-2 px-6 py-2 border-b border-[#2a2a2a] bg-[#0b0b0b] shrink-0 flex-wrap">
			{columnStatus && (
				<span
					className={classNames(
						"flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border",
						columnStatus.color,
						columnStatus.bg,
						columnStatus.border,
					)}
				>
					<span
						className={classNames("size-[7px] rounded-full shrink-0", columnStatus.dotColor)}
						style={columnStatus.glow ? { boxShadow: `0 0 5px ${columnStatus.glow}` } : {}}
					/>
					{columnStatus.label}
				</span>
			)}
			{priorityBadge && (
				<span
					className={classNames(
						"flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border",
						priorityBadge.color,
						priorityBadge.bg,
						priorityBadge.border,
					)}
				>
					<span className={classNames("size-[7px] rounded-full shrink-0", priorityBadge.dotColor)} />
					{card.priority!.charAt(0).toUpperCase() + card.priority!.slice(1)}
				</span>
			)}
			{agentBadge && (
				<span
					className={classNames(
						"flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border",
						agentBadge.color,
						agentBadge.bg,
						agentBadge.border,
					)}
				>
					<span className={classNames("size-[7px] rounded-full shrink-0", agentBadge.dotColor)} />
					{agentBadge.label}
				</span>
			)}
			{card.branchName && (
				<span className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8a8f98] bg-[#111111] border border-[#2a2a2a]">
					<GitBranch size={11} />
					{card.branchName}
				</span>
			)}
			{card.worktreePath && (
				<button
					onClick={() => void openTerminalTrigger({ body: { path: card.worktreePath! } })}
					className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8a8f98] bg-[#111111] border border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors"
				>
					<FolderOpen size={11} />
					{card.worktreePath.split("/").slice(-2).join("/")}
				</button>
			)}
			<div className="flex-1" />
			{isRunning && (
				<span className="flex items-center gap-1.5 text-[11px] font-medium text-[#ededed]">
					<Clock size={13} className="text-[#5f6672]" />
					<span className="font-mono">{formatElapsed(elapsedSec)}</span>
				</span>
			)}
		</div>
	);
}
