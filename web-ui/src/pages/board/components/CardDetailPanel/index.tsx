import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import { RunBar } from "@/components/RunBar";
import { CardDetailHeader } from "./CardDetailHeader";
import { CardDetailSidebar } from "./CardDetailSidebar";
import { CardDetailSubHeader } from "./CardDetailSubHeader";
import { CardDetailTabs } from "./CardDetailTabs";
import type { RightTab } from "./types";
import { useCardActions } from "./useCardActions";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	projectName?: string;
	onClose: () => void;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
}

export function CardDetailPanel({
	card,
	workspaceId,
	allCards,
	workflowSlots,
	projectName,
	onClose,
	onRefresh,
	onDeleteCard,
}: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);
	const [rightTab, setRightTab] = useState<RightTab>("terminal");
	const [elapsedSec, setElapsedSec] = useState(0);

	const { merging, creatingPR, handleStop, handleCommitAndMerge, handleCommitAndPR, handleDelete } = useCardActions({
		workspaceId,
		card,
		onRefresh,
		onClose,
		onDeleteCard,
	});

	const isStory = card.type === "story";
	const isReadyForReview = card.columnId === "ready_for_review";

	const visibleSessions = isStory
		? (card.terminalSessions ?? []).filter((ts) => ts.type !== "dev")
		: (card.terminalSessions ?? []);

	const commentCount = isStory
		? (card.reviewComments ?? []).filter((c) => c.type !== "dev").length +
			(card.dependsOn ?? []).reduce((sum, depId) => sum + (allCards?.[depId]?.reviewComments?.length ?? 0), 0)
		: (card.reviewComments?.length ?? 0);

	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const activeTerminalSession = card.terminalSessions?.find((ts) => !ts.endedAt);
	const hasTerminalOutput = visibleSessions.length > 0;
	const agentId = activeTerminalSession?.agentId ?? card.agentId ?? null;
	const externalUrl = card.jiraUrl ?? card.githubIssueUrl ?? card.pr?.url ?? null;

	// ── Elapsed timer ──────────────────────────────────────────────────────
	useEffect(() => {
		if (!isRunning || !activeTerminalSession) {
			setElapsedSec(0);
			return;
		}
		const update = () =>
			setElapsedSec(
				Math.floor((Date.now() - new Date(activeTerminalSession.startedAt as string | number).getTime()) / 1000),
			);
		update();
		const id = setInterval(update, 1000);
		return () => clearInterval(id);
	}, [isRunning, activeTerminalSession?.startedAt]);

	// ── Session tracking ───────────────────────────────────────────────────
	const prevCardIdRef = useRef(card.id);
	const prevSessionLenRef = useRef(card.terminalSessions?.length ?? 0);
	useEffect(() => {
		if (card.id !== prevCardIdRef.current) {
			prevCardIdRef.current = card.id;
			setActiveStreamId(card.terminalSessions?.at(-1)?.streamId ?? card.id);
			prevSessionLenRef.current = card.terminalSessions?.length ?? 0;
			setRightTab("terminal");
		}
	}, [card.id]);

	useEffect(() => {
		const sessions = card.terminalSessions ?? [];
		if (sessions.length > prevSessionLenRef.current) {
			const latest = sessions.at(-1);
			if (latest) setActiveStreamId(latest.streamId);
		}
		prevSessionLenRef.current = sessions.length;
	}, [card.terminalSessions?.length]);

	const selectSession = (streamId: string) => {
		setActiveStreamId(streamId);
		setRightTab("terminal");
	};

	return (
		<div className="fixed inset-0 z-10 bg-[#0a0a0e] flex flex-col overflow-hidden">
			<CardDetailHeader
				card={card}
				workspaceId={workspaceId}
				projectName={projectName}
				externalUrl={externalUrl}
				isStory={isStory}
				isReadyForReview={isReadyForReview}
				merging={merging}
				creatingPR={creatingPR}
				onMerge={handleCommitAndMerge}
				onPR={handleCommitAndPR}
				onDelete={handleDelete}
				onClose={onClose}
			/>

			<CardDetailSubHeader card={card} agentId={agentId} isRunning={isRunning} elapsedSec={elapsedSec} />

			{/* ── Main content ── */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				<CardDetailTabs
					card={card}
					workspaceId={workspaceId}
					allCards={allCards}
					workflowSlots={workflowSlots}
					isStory={isStory}
					isReadyForReview={isReadyForReview}
					commentCount={commentCount}
					rightTab={rightTab}
					setRightTab={setRightTab}
					hasTerminalOutput={hasTerminalOutput}
					activeStreamId={activeStreamId}
					onRefresh={onRefresh}
				/>

				<CardDetailSidebar
					card={card}
					workspaceId={workspaceId}
					allCards={allCards}
					workflowSlots={workflowSlots}
					visibleSessions={visibleSessions}
					activeStreamId={activeStreamId}
					onSelectSession={selectSession}
					onStop={handleStop}
					onRefresh={onRefresh}
				/>
			</div>

			{/* attempt count hint in bottom bar only when retries exist */}
			{card.autoFixAttempts > 0 && (
				<div className="flex items-center gap-2.5 px-6 py-2 border-t border-[#2a2a35] bg-[#141418] shrink-0">
					<span className="text-[10px] text-[#4a4a5a]">Attempt {card.autoFixAttempts + 1}</span>
				</div>
			)}
			<RunBar workspaceId={workspaceId} />
		</div>
	);
}
