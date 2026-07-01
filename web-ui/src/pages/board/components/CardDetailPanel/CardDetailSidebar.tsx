import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { useState } from "react";
import { classNames } from "@/utils/classNames";
import { CardDetailDetails } from "./CardDetailDetails";
import { WorkflowPipeline } from "./WorkflowPipeline";

type TerminalSession = NonNullable<RuntimeBoardCard["terminalSessions"]>[number];

interface CardDetailSidebarProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	visibleSessions: TerminalSession[];
	activeStreamId: string;
	onSelectSession: (streamId: string) => void;
	onStop: () => void;
	onRefresh: () => void;
}

export function CardDetailSidebar({
	card,
	workspaceId,
	allCards,
	workflowSlots,
	visibleSessions,
	activeStreamId,
	onSelectSession,
	onStop,
	onRefresh,
}: CardDetailSidebarProps) {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(
		() => localStorage.getItem("detail-sidebar-collapsed") === "true",
	);

	const toggleCollapsed = () => {
		setSidebarCollapsed((v) => {
			const next = !v;
			localStorage.setItem("detail-sidebar-collapsed", String(next));
			return next;
		});
	};

	return (
		<div
			className={classNames(
				"shrink-0 bg-[#0b0b0b] border-l border-[#2a2a2a] flex flex-col overflow-hidden transition-all duration-200",
				sidebarCollapsed ? "w-14" : "w-80",
			)}
		>
			<WorkflowPipeline
				sessions={visibleSessions}
				workflowSlots={workflowSlots}
				activeStreamId={activeStreamId}
				onSelectSession={onSelectSession}
				sidebarCollapsed={sidebarCollapsed}
				onToggleCollapsed={toggleCollapsed}
				onStop={onStop}
			/>
			{!sidebarCollapsed && (
				<CardDetailDetails
					card={card}
					workspaceId={workspaceId}
					allCards={allCards}
					workflowSlots={workflowSlots}
					onRefresh={onRefresh}
				/>
			)}
		</div>
	);
}
