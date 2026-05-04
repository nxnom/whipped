import { Droppable } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumn, RuntimeTaskSessionSummary } from "@runtime-contract";
import { KanbanCard } from "./KanbanCard";

const COLUMN_COLORS: Record<string, string> = {
	todo: "border-gray-600",
	ready_for_dev: "border-emerald-500/50",
	in_progress: "border-blue-500/50",
	in_review: "border-purple-500/50",
	reopened: "border-orange-500/50",
	ready_for_review: "border-yellow-500/50",
	blocked: "border-red-500/50",
	done: "border-gray-500/50",
};

const COLUMN_HEADER_COLORS: Record<string, string> = {
	todo: "text-gray-400",
	ready_for_dev: "text-emerald-400",
	in_progress: "text-blue-400",
	in_review: "text-purple-400",
	reopened: "text-orange-400",
	ready_for_review: "text-yellow-400",
	blocked: "text-red-400",
	done: "text-gray-400",
};

interface KanbanColumnProps {
	column: RuntimeBoardColumn;
	cards: RuntimeBoardCard[];
	sessions: Record<string, RuntimeTaskSessionSummary>;
	onCardClick: (card: RuntimeBoardCard) => void;
	onCardDetail: (card: RuntimeBoardCard) => void;
}

export function KanbanColumn({ column, cards, sessions, onCardClick, onCardDetail }: KanbanColumnProps) {
	const borderColor = COLUMN_COLORS[column.id] ?? "border-gray-600";
	const headerColor = COLUMN_HEADER_COLORS[column.id] ?? "text-gray-400";

	return (
		<div className={`flex flex-col w-72 shrink-0 bg-gray-900 border rounded-xl ${borderColor}`}>
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
							flex-1 p-2 flex flex-col gap-2 min-h-20 transition-colors
							${snapshot.isDraggingOver ? "bg-gray-800/50" : ""}
						`}
					>
						{cards.map((card, index) => (
							<KanbanCard
								key={card.id}
								card={card}
								index={index}
								session={sessions[card.id]}
								onClick={() => onCardClick(card)}
								onOpenDetail={() => onCardDetail(card)}
							/>
						))}
						{provided.placeholder}
					</div>
				)}
			</Droppable>
		</div>
	);
}
