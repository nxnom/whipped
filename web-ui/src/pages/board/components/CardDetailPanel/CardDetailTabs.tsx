import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { Brain, GitBranch, TerminalSquare } from "lucide-react";
import type React from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { CardMemoryTab } from "../CardMemoryTab";
import { ChatComments } from "../ChatComments";
import { DiffView } from "../DiffView";
import type { RightTab } from "./types";

interface CardDetailTabsProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	isStory: boolean;
	isReadyForReview: boolean;
	commentCount: number;
	rightTab: RightTab;
	setRightTab: (tab: RightTab) => void;
	hasTerminalOutput: boolean;
	activeStreamId: string;
	onRefresh: () => void;
}

export function CardDetailTabs({
	card,
	workspaceId,
	allCards,
	workflowSlots,
	isStory,
	isReadyForReview,
	commentCount,
	rightTab,
	setRightTab,
	hasTerminalOutput,
	activeStreamId,
	onRefresh,
}: CardDetailTabsProps) {
	const tabs = [
		{ id: "terminal" as RightTab, label: "Terminal", Icon: TerminalSquare },
		...(!isStory ? [{ id: "diff" as RightTab, label: "Diff", Icon: GitBranch }] : []),
		{ id: "comments" as RightTab, label: `Comments${commentCount > 0 ? ` (${commentCount})` : ""}`, Icon: null },
		{ id: "memory" as RightTab, label: "Memory", Icon: Brain },
	] as { id: RightTab; label: string; Icon: React.FC<{ size: number }> | null }[];

	return (
		<div className="flex-1 min-w-0 flex flex-col bg-[#141418]">
			{/* Tab bar */}
			<div className="flex shrink-0 bg-[#0d0d12] border-b border-[#2a2a35] px-5">
				{tabs.map(({ id, label, Icon }) => (
					<button
						key={id}
						onClick={() => setRightTab(id)}
						className={classNames(
							"relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors",
							rightTab === id ? "text-[#f0f0f5]" : "text-[#4a4a5a] hover:text-[#8888a0]",
						)}
					>
						{Icon && <Icon size={11} />}
						{label}
						{rightTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7c6aff]" />}
					</button>
				))}
			</div>

			{rightTab === "terminal" &&
				(hasTerminalOutput ? (
					<TaskTerminal key={activeStreamId} taskId={activeStreamId} workspaceId={workspaceId} className="flex-1" />
				) : (
					<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-600">
						<span className="text-4xl">⌨</span>
						<p className="text-sm">No agent output yet</p>
						<p className="text-xs">Start the agent to see terminal output here</p>
					</div>
				))}
			{rightTab === "diff" && (
				<DiffView
					workspaceId={workspaceId}
					cardId={card.id}
					isReadyForReview={isReadyForReview}
					onRefresh={onRefresh}
				/>
			)}
			{rightTab === "comments" && (
				<ChatComments
					card={card}
					workspaceId={workspaceId}
					allCards={allCards}
					workflowSlots={workflowSlots}
					onRefresh={onRefresh}
				/>
			)}
			{rightTab === "memory" && <CardMemoryTab cardId={card.id} />}
		</div>
	);
}
