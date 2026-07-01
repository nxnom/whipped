import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { Check, Loader2 } from "lucide-react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { CardMemoryTab } from "../CardMemoryTab";
import { ChatComments } from "../ChatComments";
import { DiffView } from "../DiffView";
import { SESSION_TYPE_LABELS, sessionStatus } from "./constants";
import type { RightTab } from "./types";

type TerminalSession = NonNullable<RuntimeBoardCard["terminalSessions"]>[number];

interface CardDetailTabsProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	isReadyForReview: boolean;
	rightTab: RightTab;
	hasTerminalOutput: boolean;
	visibleSessions: TerminalSession[];
	activeStreamId: string;
	onRefresh: () => void;
}

export function CardDetailTabs({
	card,
	workspaceId,
	allCards,
	workflowSlots,
	isReadyForReview,
	rightTab,
	hasTerminalOutput,
	visibleSessions,
	activeStreamId,
	onRefresh,
}: CardDetailTabsProps) {
	const hasPlan = !!card.plan?.trim();
	const activeSession = visibleSessions.find((s) => s.streamId === activeStreamId);
	const installSession = visibleSessions.find((s) => s.type === "install");

	const sessionPill = (session: TerminalSession) => {
		const slotName =
			workflowSlots?.find((s) => s.id === session.type)?.name ?? SESSION_TYPE_LABELS[session.type] ?? session.type;
		const status = sessionStatus(session);
		return (
			<span
				key={session.streamId}
				className="flex items-center gap-1.5 px-2.5 py-[7px] rounded-md bg-[#111111] border border-[#2a2a2a]"
			>
				{status === "running" ? (
					<Loader2 size={13} className="text-[#22c55e] animate-spin" />
				) : status === "completed" ? (
					<Check size={13} className="text-[#22c55e]" />
				) : (
					<span
						className={classNames(
							"size-[7px] rounded-full",
							status === "failed" ? "bg-[#ff3b4d]" : status === "stopped" ? "bg-[#eab308]" : "bg-[#5f6672]",
						)}
					/>
				)}
				<span className="text-xs font-semibold text-[#ededed]">
					{slotName} · {status}
				</span>
			</span>
		);
	};

	return (
		<div className="flex-1 min-w-0 flex flex-col bg-whip-bg">
			{rightTab === "terminal" &&
				(hasTerminalOutput ? (
					<div className="flex-1 min-h-0 flex flex-col gap-2.5 p-5 bg-[#070707]">
						<div className="flex items-center gap-2 shrink-0">
							{activeSession && sessionPill(activeSession)}
							{installSession && installSession.streamId !== activeSession?.streamId && sessionPill(installSession)}
							<div className="flex-1" />
							<span className="text-[11px] font-mono text-[#5f6672]">stream: {activeStreamId}</span>
						</div>
						<div className="flex-1 min-h-0 rounded-md border border-[#1f1f1f] bg-[#0b0b0b] p-3 overflow-hidden">
							<TaskTerminal key={activeStreamId} taskId={activeStreamId} workspaceId={workspaceId} className="h-full" />
						</div>
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center flex-col gap-3 text-[#5f6672]">
						<span className="text-4xl">⌨</span>
						<p className="text-sm">No agent output yet</p>
						<p className="text-xs">Start the agent to see terminal output here</p>
					</div>
				))}
			{rightTab === "diff" && (
				<DiffView
					workspaceId={workspaceId}
					cardId={card.id}
					activeLevel={card.activeLevel}
					isReadyForReview={isReadyForReview}
					onRefresh={onRefresh}
				/>
			)}
			{rightTab === "plan" && (
				<div className="flex-1 overflow-y-auto p-5">
					{hasPlan ? (
						<p className="text-[13px] text-[#ededed] whitespace-pre-wrap leading-relaxed">{card.plan}</p>
					) : (
						<div className="flex-1 flex items-center justify-center text-xs text-[#5f6672]">No plan for this card</div>
					)}
				</div>
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
