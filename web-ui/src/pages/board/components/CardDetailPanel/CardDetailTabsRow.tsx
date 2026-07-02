import type { RuntimeBoardCard } from "@runtime-contract";
import { Clock, FolderOpen, GitBranch } from "lucide-react";
import type React from "react";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { AGENT_DISPLAY, formatElapsed, PRIORITY_BADGE } from "./constants";
import type { RightTab } from "./types";

interface CardDetailTabsRowProps {
	card: RuntimeBoardCard;
	agentId: string | null;
	isRunning: boolean;
	elapsedSec: number;
	tabs: { id: RightTab; label: string; Icon: React.FC<{ size: number }> | null }[];
	rightTab: RightTab;
	setRightTab: (tab: RightTab) => void;
}

export function CardDetailTabsRow({
	card,
	agentId,
	isRunning,
	elapsedSec,
	tabs,
	rightTab,
	setRightTab,
}: CardDetailTabsRowProps) {
	const { trigger: openTerminalTrigger } = useWrite((api) => api("fs/open-terminal").POST());
	const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null;
	const agentBadge = agentId ? (AGENT_DISPLAY[agentId] ?? null) : null;

	return (
		<div className="flex items-center gap-3.5 px-6 h-11 border-b border-whip-border-soft bg-whip-bg shrink-0">
			<div className="flex items-center h-full">
				{tabs.map(({ id, label, Icon }) => (
					<button
						key={id}
						onClick={() => setRightTab(id)}
						className={classNames(
							"relative flex items-center gap-1.5 px-3 h-full text-xs font-medium transition-colors",
							rightTab === id ? "text-whip-text" : "text-whip-muted hover:text-whip-text",
						)}
					>
						{Icon && <Icon size={12} />}
						{label}
						{rightTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-whip-accent" />}
					</button>
				))}
			</div>
			<div className="flex-1" />
			{priorityBadge && (
				<span
					className={classNames(
						"flex items-center gap-1.5 px-2 py-[5px] rounded-md text-[11px] font-medium border",
						priorityBadge.color,
						priorityBadge.bg,
						priorityBadge.border,
					)}
				>
					<span className={classNames("size-[6px] rounded-full shrink-0", priorityBadge.dotColor)} />
					{card.priority!.charAt(0).toUpperCase() + card.priority!.slice(1)}
				</span>
			)}
			{agentBadge && (
				<span
					className={classNames(
						"flex items-center gap-1.5 px-2 py-[5px] rounded-md text-[11px] font-medium border",
						agentBadge.color,
						agentBadge.bg,
						agentBadge.border,
					)}
				>
					<span className={classNames("size-[6px] rounded-full shrink-0", agentBadge.dotColor)} />
					{agentBadge.label}
				</span>
			)}
			{card.branchName && (
				<span className="flex items-center gap-1.5 px-2 py-[5px] rounded-md bg-whip-panel border border-whip-border text-[11px] font-mono font-semibold text-whip-muted">
					<GitBranch size={11} className="text-whip-faint" />
					{card.branchName}
				</span>
			)}
			{card.worktreePath && (
				<button
					onClick={() => void openTerminalTrigger({ body: { path: card.worktreePath! } })}
					className="flex items-center gap-1.5 px-2 py-[5px] rounded-md bg-whip-panel border border-whip-border text-[11px] font-mono font-semibold text-whip-muted hover:border-whip-border-hover transition-colors"
				>
					<FolderOpen size={11} className="text-whip-faint" />
					{card.worktreePath.split("/").slice(-2).join("/")}
				</button>
			)}
			{isRunning && (
				<span className="flex items-center gap-1.5 text-[11px] font-medium text-whip-text">
					<Clock size={13} className="text-whip-faint" />
					<span className="font-mono">{formatElapsed(elapsedSec)}</span>
				</span>
			)}
		</div>
	);
}
