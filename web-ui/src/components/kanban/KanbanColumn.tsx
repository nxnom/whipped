import { Droppable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumn, Workflow } from "@runtime-contract";
import { KanbanCard } from "./KanbanCard";

const COLUMN_COLORS: Record<string, string> = {
	todo: "border-gray-600",
	in_progress: "border-blue-500/50",
	reopened: "border-orange-500/50",
	ready_for_review: "border-yellow-500/50",
	blocked: "border-red-500/50",
	done: "border-gray-500/50",
};

const COLUMN_HEADER_COLORS: Record<string, string> = {
	todo: "text-gray-400",
	in_progress: "text-blue-400",
	reopened: "text-orange-400",
	ready_for_review: "text-yellow-400",
	blocked: "text-red-400",
	done: "text-gray-400",
};

interface KanbanColumnProps {
	column: RuntimeBoardColumn;
	cards: RuntimeBoardCard[];
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	workspaceId: string;
	runningCardId: string | null;
	onCardClick: (card: RuntimeBoardCard) => void;
	onCardEdit: (card: RuntimeBoardCard) => void;
	onCardDelete: (card: RuntimeBoardCard) => void;
	onCardToggleReady: (card: RuntimeBoardCard) => void;
	onCardRun: (cardId: string) => void;
	onCardStop: () => void;
}

export function KanbanColumn({ column, cards, allCards, workflows, workspaceId, runningCardId, onCardClick, onCardEdit, onCardDelete, onCardToggleReady, onCardRun, onCardStop }: KanbanColumnProps) {
	const borderColor = COLUMN_COLORS[column.id] ?? "border-gray-600";
	const headerColor = COLUMN_HEADER_COLORS[column.id] ?? "text-gray-400";

	return (
		<div className={`flex flex-col w-72 shrink-0 bg-gray-900 border rounded-xl overflow-hidden ${borderColor}`}>
			<div className="px-3 py-2.5 border-b border-gray-800">
				<div className="flex items-center justify-between">
					<h3 className={`text-sm font-semibold ${headerColor}`}>{column.title}</h3>
					<span className="text-xs text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">{cards.length}</span>
				</div>
			</div>

			<Droppable droppableId={column.id}>
				{(provided, snapshot) => (
					<div
						ref={provided.innerRef}
						{...provided.droppableProps}
						className={`
							flex-1 p-2 flex flex-col gap-2 min-h-20 overflow-y-auto transition-colors
							${snapshot.isDraggingOver ? "bg-gray-800/50" : ""}
						`}
					>
						{cards.map((card, index) => (
							<KanbanCard
								key={card.id}
								card={card}
								index={index}
								allCards={allCards}
								workflowName={workflows.find(w => w.id === card.workflowId)?.name}
								workspaceId={workspaceId}
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
