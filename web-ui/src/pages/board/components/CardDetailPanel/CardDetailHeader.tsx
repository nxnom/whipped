import { Tooltip } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import { ArrowLeft, ExternalLink, GitMerge, GitPullRequest, Play, Square, Trash2 } from "lucide-react";
import { useRunSession } from "@/stores/run-session-store";

interface CardDetailHeaderProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	projectName?: string;
	externalUrl: string | null;
	isStory: boolean;
	isReadyForReview: boolean;
	hasStartCommand?: boolean;
	merging: boolean;
	onMerge: () => void;
	onPR: () => void;
	onDelete: () => void;
	onClose: () => void;
}

export function CardDetailHeader({
	card,
	workspaceId,
	projectName,
	externalUrl,
	isStory,
	isReadyForReview,
	hasStartCommand = false,
	merging,
	onMerge,
	onPR,
	onDelete,
	onClose,
}: CardDetailHeaderProps) {
	const { session: runSession, start: startRun, stop: stopRun } = useRunSession(workspaceId);

	return (
		<div className="flex items-center gap-3 px-6 py-2.5 border-b border-[#2a2a2a] bg-[#0b0b0b] shrink-0">
			<button onClick={onClose} className="text-[#5f6672] hover:text-[#ededed] transition-colors" title="Back to board">
				<ArrowLeft size={18} />
			</button>
			<div className="w-px h-[18px] bg-[#2a2a2a] shrink-0" />
			{projectName && (
				<>
					<span className="text-xs text-[#5f6672]">{projectName}</span>
					<span className="text-xs text-[#2a2a2a]">/</span>
				</>
			)}
			<span className="text-[13px] font-semibold text-[#ededed] truncate">
				{card.description?.split("\n")[0] ?? card.id}
			</span>
			<div className="flex-1" />
			{externalUrl && !card.pr?.url && (
				<a
					href={externalUrl}
					target="_blank"
					rel="noreferrer"
					className="text-[#5f6672] hover:text-[#ededed] transition-colors"
					title="Open external link"
				>
					<ExternalLink size={15} />
				</a>
			)}
			<div className="w-px h-[18px] bg-[#2a2a2a] shrink-0" />
			{/* Action buttons */}
			{hasStartCommand && (
				<>
					{runSession.status === "running" && runSession.cardId === card.id ? (
						<Tooltip delayDuration={0} content="Stop" side="bottom" triggerAsChild>
							<button
								onClick={() => void stopRun()}
								className="cursor-pointer text-[#5f6672] hover:text-[#ff3b4d] transition-colors"
							>
								<Square size={15} className="fill-current" />
							</button>
						</Tooltip>
					) : (
						<Tooltip
							delayDuration={0}
							content={runSession.status === "running" ? "Another task is running" : "Run"}
							side="bottom"
							triggerAsChild
						>
							<button
								onClick={() => void startRun(card.id)}
								disabled={runSession.status === "running"}
								className="cursor-pointer text-[#5f6672] hover:text-[#22c55e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<Play size={15} />
							</button>
						</Tooltip>
					)}
				</>
			)}
			{!isStory && isReadyForReview && (
				<>
					<Tooltip
						delayDuration={0}
						content={merging ? "Merging..." : `Merge into ${card.baseRef}`}
						side="bottom"
						triggerAsChild
					>
						<button
							onClick={onMerge}
							disabled={merging}
							className="cursor-pointer text-[#5f6672] hover:text-[#22c55e] transition-colors disabled:opacity-40"
						>
							<GitMerge size={15} />
						</button>
					</Tooltip>
					{card.pr?.url ? (
						<a
							href={card.pr.url}
							target="_blank"
							rel="noreferrer"
							title="Open Pull Request"
							className="cursor-pointer text-[#22c55e] hover:text-[#22c55e] transition-colors"
						>
							<GitPullRequest size={15} />
						</a>
					) : (
						<Tooltip delayDuration={0} content={`Create PR against ${card.baseRef}`} side="bottom" triggerAsChild>
							<button
								onClick={onPR}
								disabled={merging}
								className="cursor-pointer text-[#5f6672] hover:text-[#22c55e] transition-colors disabled:opacity-40"
							>
								<GitPullRequest size={15} />
							</button>
						</Tooltip>
					)}
				</>
			)}
			<div className="w-px h-[18px] bg-[#2a2a2a] shrink-0" />
			<Tooltip delayDuration={0} content="Delete task" side="bottom" triggerAsChild>
				<button
					onClick={onDelete}
					className="cursor-pointer text-[#5f6672] hover:text-[#ff3b4d] transition-colors"
					title="Delete task"
				>
					<Trash2 size={15} />
				</button>
			</Tooltip>
		</div>
	);
}
