import { Droppable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumn, Workflow } from "@runtime-contract";
import { Plus } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { KanbanCard } from "./KanbanCard";

const COLUMN_DOT_COLORS: Record<string, string> = {
	todo: "bg-gray-500",
	in_progress: "bg-blue-500",
	reopened: "bg-orange-500",
	ready_for_review: "bg-yellow-500",
	blocked: "bg-red-500",
	done: "bg-gray-500",
};

interface KanbanColumnProps {
	column: RuntimeBoardColumn;
	cards: RuntimeBoardCard[];
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	runningCardId: string | null;
	onCardClick: (card: RuntimeBoardCard) => void;
	onCardEdit: (card: RuntimeBoardCard) => void;
	onCardDelete: (card: RuntimeBoardCard) => void;
	onCardToggleReady: (card: RuntimeBoardCard) => void;
	onCardRun: (cardId: string) => void;
	onCardStop: () => void;
	onAddCard?: () => void;
}

export function KanbanColumn({
	column,
	cards,
	allCards,
	workflows,
	runningCardId,
	onCardClick,
	onCardEdit,
	onCardDelete,
	onCardToggleReady,
	onCardRun,
	onCardStop,
	onAddCard,
}: KanbanColumnProps) {
	return (
		<div className="flex flex-col w-60 shrink-0">
			<div className="flex items-center gap-1.5 px-2.5 py-2 shrink-0">
				<span className={classNames("size-2 rounded-full shrink-0", COLUMN_DOT_COLORS[column.id] ?? "bg-gray-500")} />
				<span className="text-xs font-medium text-[#8888a0]">{column.title}</span>
				<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2a2a35] text-gray-500 font-medium">
					{cards.length}
				</span>
				<div className="flex-1" />
				<button onClick={onAddCard} className="text-gray-600 hover:text-gray-400 transition-colors" title="Add task">
					<Plus size={13} />
				</button>
			</div>

			<Droppable droppableId={column.id}>
				{(provided, snapshot) => (
					<div
						ref={provided.innerRef}
						{...provided.droppableProps}
						className={classNames(
							"flex-1 px-0 pt-1 pb-2 flex flex-col gap-2 min-h-20 overflow-y-auto transition-colors rounded-lg",
							snapshot.isDraggingOver ? "bg-[#1a1a1f]/40" : "",
						)}
					>
						{cards.map((card, index) => (
							<KanbanCard
								key={card.id}
								card={card}
								index={index}
								allCards={allCards}
								workflowName={workflows.find((w) => w.id === card.workflowId)?.name}
								isRunning={runningCardId === card.id}
								onClick={() => onCardClick(card)}
								onEdit={() => onCardEdit(card)}
								onDelete={() => onCardDelete(card)}
								onToggleReady={() => onCardToggleReady(card)}
								onRun={() => onCardRun(card.id)}
								onStop={onCardStop}
							/>
						))}
						{provided.placeholder}
					</div>
				)}
			</Droppable>
		</div>
	);
}
