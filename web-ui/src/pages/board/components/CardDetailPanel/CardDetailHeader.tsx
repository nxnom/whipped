import { Tooltip } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import { ArrowLeft, ExternalLink, GitMerge, GitPullRequest, Play, Square, Trash2 } from "lucide-react";
import { useRunSession } from "@/stores/run-session-store";
import { classNames } from "@/utils/classNames";
import { COLUMN_STATUS } from "./constants";

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

const ACTION_BUTTON =
	"flex items-center justify-center size-[34px] rounded-md bg-[#111111] border border-[#2a2a2a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

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
	const columnStatus = COLUMN_STATUS[card.columnId];

	return (
		<div className="flex items-center gap-3 px-6 h-14 border-b border-[#1f1f1f] bg-[#050505] shrink-0">
			<button onClick={onClose} className="text-[#8a8f98] hover:text-[#ededed] transition-colors" title="Back to board">
				<ArrowLeft size={18} />
			</button>
			<div className="w-px h-5 bg-[#2a2a2a] shrink-0" />
			<div className="flex flex-col gap-[3px] min-w-0 flex-1 max-w-[720px]">
				<div className="flex items-center gap-1.5 text-[11px]">
					{projectName && <span className="text-[#8a8f98]">{projectName}</span>}
					{projectName && columnStatus && <span className="text-[#5f6672]">/</span>}
					{columnStatus && (
						<span className={classNames("font-semibold", columnStatus.color)}>{columnStatus.label}</span>
					)}
				</div>
				<span className="text-sm font-semibold text-[#ededed] truncate">
					{card.description?.split("\n")[0] ?? card.id}
				</span>
			</div>
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
			{hasStartCommand &&
				(runSession.status === "running" && runSession.cardId === card.id ? (
					<Tooltip delayDuration={0} content="Stop" side="bottom" triggerAsChild>
						<button
							onClick={() => void stopRun()}
							className={classNames(ACTION_BUTTON, "text-[#8a8f98] hover:text-[#ff3b4d]")}
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
							className={classNames(ACTION_BUTTON, "text-[#ededed] hover:text-[#22c55e]")}
						>
							<Play size={15} />
						</button>
					</Tooltip>
				))}
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
							className={classNames(ACTION_BUTTON, "text-[#8a8f98] hover:text-[#22c55e]")}
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
							className={classNames(ACTION_BUTTON, "text-[#22c55e]")}
						>
							<GitPullRequest size={15} />
						</a>
					) : (
						<Tooltip delayDuration={0} content={`Create PR against ${card.baseRef}`} side="bottom" triggerAsChild>
							<button
								onClick={onPR}
								disabled={merging}
								className={classNames(ACTION_BUTTON, "text-[#8a8f98] hover:text-[#22c55e]")}
							>
								<GitPullRequest size={15} />
							</button>
						</Tooltip>
					)}
				</>
			)}
			<Tooltip delayDuration={0} content="Delete task" side="bottom" triggerAsChild>
				<button
					onClick={onDelete}
					className="flex items-center justify-center size-[34px] rounded-md text-[#ff3b4d] hover:bg-[#ff3b4d]/10 transition-colors"
					title="Delete task"
				>
					<Trash2 size={15} />
				</button>
			</Tooltip>
		</div>
	);
}
