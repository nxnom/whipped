import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { useWrite } from "@/runtime/api-client";
import { CardMemoryTab } from "../CardMemoryTab";
import { ChatComments } from "../ChatComments";
import { type DiffCommentSystem, DiffView } from "../DiffView";
import { useDiffData } from "../DiffView/useDiffData";
import type { RightTab } from "./types";

interface CardDetailTabsProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	isReadyForReview: boolean;
	rightTab: RightTab;
	hasTerminalOutput: boolean;
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
	activeStreamId,
	onRefresh,
}: CardDetailTabsProps) {
	const hasPlan = !!card.plan?.trim();

	const diffData = useDiffData(workspaceId, card.id, rightTab === "diff");
	const { trigger: addReviewCommentTrigger } = useWrite((api) => api("cards/add-review-comment").POST());
	const { trigger: submitHumanFeedbackTrigger } = useWrite((api) => api("cards/submit-human-feedback").POST());
	const { trigger: updateCardTrigger } = useWrite((api) => api("cards/:id").PATCH());

	const commentSystem: DiffCommentSystem = {
		isReadyForReview,
		activeLevel: card.activeLevel,
		onRefresh,
		addComment: async (summary) => {
			const res = await addReviewCommentTrigger({
				body: { workspaceId, cardId: card.id, type: "human", actor: { type: "human", id: "human" }, summary },
			});
			return !res.error;
		},
		submitFeedback: async (comment) => {
			await submitHumanFeedbackTrigger({ body: { workspaceId, cardId: card.id, comment } });
		},
		setActiveLevel: async (level) => {
			await updateCardTrigger({
				params: { id: card.id },
				body: { workspaceId, cardId: card.id, revision: 0, activeLevel: level },
			});
		},
	};

	return (
		<div className="flex-1 min-w-0 flex flex-col bg-whip-bg">
			{rightTab === "terminal" &&
				(hasTerminalOutput ? (
					<div className="flex-1 h-full p-1">
						<TaskTerminal key={activeStreamId} taskId={activeStreamId} workspaceId={workspaceId} className="h-full" />
					</div>
				) : (
					<div className="flex-1 flex items-center justify-center flex-col gap-3 text-whip-faint">
						<span className="text-4xl">⌨</span>
						<p className="text-sm">No agent output yet</p>
						<p className="text-xs">Start the agent to see terminal output here</p>
					</div>
				))}
			{rightTab === "diff" && <DiffView diffData={diffData} commentSystem={commentSystem} />}
			{rightTab === "plan" && (
				<div className="flex-1 overflow-y-auto p-5">
					{hasPlan ? (
						<p className="text-[13px] text-whip-text whitespace-pre-wrap leading-relaxed">{card.plan}</p>
					) : (
						<div className="flex-1 flex items-center justify-center text-xs text-whip-faint">No plan for this card</div>
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
