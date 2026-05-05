import { Button, Input, Select, SelectOption, Textarea, toast } from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { CardDetailPanel } from "./CardDetailPanel";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
	state: RuntimeWorkspaceStateResponse;
	onRefresh: () => void;
}

export function KanbanBoard({ state, onRefresh }: KanbanBoardProps) {
	const [detailCardId, setDetailCardId] = useState<string | null>(null);
	const detailCard = detailCardId ? (state.board.cards[detailCardId] ?? null) : null;
	const [showCreate, setShowCreate] = useState(false);

	const handleDragEnd = async (result: DropResult) => {
		if (!result.destination) return;
		if (
			result.destination.droppableId === result.source.droppableId &&
			result.destination.index === result.source.index
		)
			return;

		try {
			await trpc.cards.move.mutate({
				workspaceId: state.workspaceId,
				cardId: result.draggableId,
				targetColumnId: result.destination.droppableId as RuntimeBoardColumnId,
				targetIndex: result.destination.index,
				revision: state.revision,
			});
			onRefresh();
		} catch {
			toast.error("Failed to move card");
		}
	};

	return (
		<div className="flex-1 overflow-hidden flex flex-col relative">
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
				<h2 className="text-sm font-medium text-gray-300">Board</h2>
				<Button size="sm" variant="outlined" onClick={() => setShowCreate(true)}>
					<Plus size={13} className="mr-1" /> New task
				</Button>
			</div>

			<div className="flex-1 overflow-x-auto">
				<DragDropContext onDragEnd={handleDragEnd}>
					<div className="flex gap-3 p-4 h-full">
						{state.board.columns.map((column) => {
							const cards = column.taskIds
								.map((id) => state.board.cards[id])
								.filter((c): c is RuntimeBoardCard => Boolean(c));
							return (
								<KanbanColumn
									key={column.id}
									column={column}
									cards={cards}
									sessions={state.sessions}
									onCardClick={(card) => setDetailCardId(card.id)}
								/>
							);
						})}
					</div>
				</DragDropContext>
			</div>

			{detailCard && (
				<CardDetailPanel
					card={detailCard}
					workspaceId={state.workspaceId}
					session={state.sessions[detailCard.id]}
					onClose={() => setDetailCardId(null)}
					onRefresh={onRefresh}
				/>
			)}

			{showCreate && (
				<CreateCardDialog
					workspaceId={state.workspaceId}
					onClose={() => setShowCreate(false)}
					onRefresh={() => {
						onRefresh();
						setShowCreate(false);
					}}
				/>
			)}
		</div>
	);
}

function CreateCardDialog({
	workspaceId,
	onClose,
	onRefresh,
}: {
	workspaceId: string;
	onClose: () => void;
	onRefresh: () => void;
}) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [agentId, setAgentId] = useState<"claude" | "codex">("claude");
	const [baseRef, setBaseRef] = useState<string>("");
	const [branches, setBranches] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		trpc.cards.listBranches
			.query({ workspaceId })
			.then(({ branches: b, defaultBranch }) => {
				setBranches(b);
				setBaseRef(defaultBranch);
			})
			.catch(() => {});
	}, [workspaceId]);

	const handleCreate = async () => {
		if (!title.trim()) return;
		setLoading(true);
		try {
			await trpc.cards.create.mutate({ workspaceId, title: title.trim(), description, agentId, baseRef: baseRef || undefined });
			onRefresh();
		} catch {
			toast.error("Failed to create task");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-md"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-base font-semibold text-gray-100 mb-4">New Task</h3>

				<div className="space-y-3">
					<div>
						<label className="text-xs text-gray-400 block mb-1">Title</label>
						<Input
							autoFocus
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCreate()}
							placeholder="Task title..."
						/>
					</div>
					<div>
						<label className="text-xs text-gray-400 block mb-1">Description</label>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Describe what needs to be done..."
							rows={4}
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="text-xs text-gray-400 block mb-1">Base Branch</label>
							<Select value={baseRef} onChange={(v) => setBaseRef(v as string)} placeholder="Select branch">
								{branches.map((b) => (
									<SelectOption key={b} value={b} label={b} />
								))}
							</Select>
						</div>
						<div>
							<label className="text-xs text-gray-400 block mb-1">Agent</label>
							<Select value={agentId} onChange={(v) => setAgentId(v as "claude" | "codex")} placeholder="Select agent">
								<SelectOption value="claude" label="Claude Code" />
								<SelectOption value="codex" label="OpenAI Codex" />
							</Select>
						</div>
					</div>
				</div>

				<div className="flex gap-2 mt-5 justify-end">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleCreate} disabled={!title.trim() || loading}>
						{loading ? "Creating..." : "Create"}
					</Button>
				</div>
			</div>
		</div>
	);
}
