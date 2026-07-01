import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { Brain, GitBranch, ScrollText, TerminalSquare } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { RunBar } from "@/components/RunBar";
import { useRead } from "@/runtime/api-client";
import { CardDetailHeader } from "./CardDetailHeader";
import { CardDetailSidebar } from "./CardDetailSidebar";
import { CardDetailTabs } from "./CardDetailTabs";
import { CardDetailTabsRow } from "./CardDetailTabsRow";
import type { RightTab } from "./types";
import { useCardActions } from "./useCardActions";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	projectName?: string;
	hasStartCommand?: boolean;
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
	hasStartCommand = false,
	onClose,
	onRefresh,
	onDeleteCard,
}: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);
	const [rightTab, setRightTab] = useState<RightTab>("terminal");
	const [elapsedSec, setElapsedSec] = useState(0);

	const { merging, handleStop, handleCommitAndMerge, handleCommitAndPR, handleDelete } = useCardActions({
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
			(card.subtaskIds ?? []).reduce((sum, depId) => sum + (allCards?.[depId]?.reviewComments?.length ?? 0), 0)
		: (card.reviewComments?.length ?? 0);

	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const activeTerminalSession = card.terminalSessions?.find((ts) => !ts.endedAt);
	const hasTerminalOutput = visibleSessions.length > 0;
	const agentId = activeTerminalSession?.agentId ?? card.agentId ?? null;
	const externalUrl = card.githubIssueUrl ?? card.pr?.url ?? null;

	// Shared cache key with the Memory tab's own read, so the count and the tab stay in sync.
	const { data: memData } = useRead((api) => api("memory/for-card").GET({ query: { cardId: card.id } }));
	const memoryCount = memData?.length ?? 0;
	const hasPlan = !!card.plan?.trim();

	const tabs = [
		{ id: "terminal" as RightTab, label: "Terminal", Icon: TerminalSquare },
		...(!isStory ? [{ id: "diff" as RightTab, label: "Diff", Icon: GitBranch }] : []),
		...(hasPlan ? [{ id: "plan" as RightTab, label: "Plan", Icon: ScrollText }] : []),
		{ id: "comments" as RightTab, label: `Comments${commentCount > 0 ? ` (${commentCount})` : ""}`, Icon: null },
		{ id: "memory" as RightTab, label: `Memory${memoryCount > 0 ? ` (${memoryCount})` : ""}`, Icon: Brain },
	] as { id: RightTab; label: string; Icon: React.FC<{ size: number }> | null }[];

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
		<div className="fixed inset-0 z-10 bg-[#050505] flex flex-col overflow-hidden">
			<CardDetailHeader
				card={card}
				workspaceId={workspaceId}
				projectName={projectName}
				externalUrl={externalUrl}
				isStory={isStory}
				isReadyForReview={isReadyForReview}
				hasStartCommand={hasStartCommand}
				merging={merging}
				onMerge={handleCommitAndMerge}
				onPR={handleCommitAndPR}
				onDelete={handleDelete}
				onClose={onClose}
			/>

			<CardDetailTabsRow
				card={card}
				agentId={agentId}
				isRunning={isRunning}
				elapsedSec={elapsedSec}
				tabs={tabs}
				rightTab={rightTab}
				setRightTab={setRightTab}
			/>

			{/* ── Main content ── */}
			<div className="flex flex-1 min-h-0 overflow-hidden">
				<CardDetailTabs
					card={card}
					workspaceId={workspaceId}
					allCards={allCards}
					workflowSlots={workflowSlots}
					isReadyForReview={isReadyForReview}
					rightTab={rightTab}
					hasTerminalOutput={hasTerminalOutput}
					visibleSessions={visibleSessions}
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
				<div className="flex items-center gap-2.5 px-6 py-2 border-t border-[#2a2a2a] bg-[#0b0b0b] shrink-0">
					<span className="text-[10px] text-[#5f6672]">Attempt {card.autoFixAttempts + 1}</span>
				</div>
			)}
			<RunBar workspaceId={workspaceId} />
		</div>
	);
}
