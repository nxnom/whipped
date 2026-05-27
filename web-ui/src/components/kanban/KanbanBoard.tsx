import { ConfirmDialog, toast } from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import { ChevronDown, GitBranch, Layers, MessageSquare, Play, Plus, Settings, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/runtime/trpc-client";
import { useRunSession } from "@/stores/run-session-store";
import { CardDetailPanel } from "./CardDetailPanel";
import { CreateTaskDialog, EditTaskDialog } from "./CreateTaskDialog";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
	state: RuntimeWorkspaceStateResponse;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
	onOpenSettings: () => void;
	onOpenAgent: () => void;
	projectName?: string;
}

export function KanbanBoard({
	state,
	onRefresh,
	onDeleteCard,
	onOpenSettings,
	onOpenAgent,
	projectName,
}: KanbanBoardProps) {
	const navigate = useNavigate();
	const { workspaceId: urlWorkspaceId, cardId: detailCardId } = useParams<{ workspaceId: string; cardId?: string }>();
	const workspaceId = urlWorkspaceId!;
	const { session: runSession, start: startRun, startBase: startBaseRun, stop: stopRun } = useRunSession(workspaceId);

	const handleRun = async (cardId: string) => {
		try {
			await startRun(cardId);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(msg);
		}
	};

	const handleRunBase = async () => {
		try {
			await startBaseRun();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(msg);
		}
	};

	const handleStop = async () => {
		try {
			await stopRun();
		} catch {
			toast.error("Failed to stop");
		}
	};
	const detailCard = detailCardId ? (state.board.cards[detailCardId] ?? null) : null;
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createDialogMode, setCreateDialogMode] = useState<"task" | "story">("task");
	const [editDialogCard, setEditDialogCard] = useState<RuntimeBoardCard | null>(null);
	const [currentBranch, setCurrentBranch] = useState<string>("");

	useEffect(() => {
		trpc.cards.listBranches
			.query({ workspaceId })
			.then(({ defaultBranch }) => setCurrentBranch(defaultBranch))
			.catch(() => {});
	}, [workspaceId]);

	const openCard = (id: string) =>
		navigate(`/${encodeURIComponent(workspaceId)}/board/${encodeURIComponent(id)}`, { replace: true });
	const closeCard = () => navigate(`/${encodeURIComponent(workspaceId)}/board`, { replace: true });

	const handleCardDelete = (card: RuntimeBoardCard) => {
		ConfirmDialog.show({
			title: "Delete task?",
			content: `"${card.description?.split("\n")[0] ?? card.id}" will be permanently deleted.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					onDeleteCard(card.id);
					dismiss();
					await trpc.cards.delete.mutate({
						workspaceId: workspaceId,
						cardId: card.id,
					});
					onRefresh();
				} catch {
					toast.error("Failed to delete task");
					onRefresh(); // revert optimistic update on failure
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleToggleReady = async (card: RuntimeBoardCard) => {
		try {
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				readyForDev: !card.readyForDev,
				revision: 0,
			});
			onRefresh();
		} catch {
			toast.error("Failed to update task");
		}
	};

	const openEditDialog = (card: RuntimeBoardCard) => {
		setEditDialogCard(card);
	};

	const _handleMoveAllToReady = () => {
		const todoColumn = state.board.columns.find((c) => c.id === "todo");
		const todoCards = (todoColumn?.taskIds ?? []).map((id) => state.board.cards[id]).filter((c) => c && !c.readyForDev);
		if (todoCards.length === 0) {
			toast.info("No unready tasks in Todo");
			return;
		}
		ConfirmDialog.show({
			title: "Mark all as Ready?",
			content: `${todoCards.length} task${todoCards.length === 1 ? "" : "s"} will be marked as ready for the agent to pick up.`,
			confirmButtonLabel: "Mark all",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				try {
					for (const card of todoCards) {
						await trpc.cards.update.mutate({
							workspaceId: workspaceId,
							cardId: card!.id,
							readyForDev: true,
							revision: 0,
						});
					}
					onRefresh();
					toast.success(`Marked ${todoCards.length} task${todoCards.length === 1 ? "" : "s"} as ready`);
				} catch {
					toast.error("Failed to mark tasks as ready");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleDragEnd = async (result: DropResult) => {
		if (!result.destination) return;
		if (
			result.destination.droppableId === result.source.droppableId &&
			result.destination.index === result.source.index
		)
			return;

		try {
			await trpc.cards.move.mutate({
				workspaceId: workspaceId,
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
			<div className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2a35] shrink-0">
				<h2 className="text-sm font-semibold text-gray-100">{projectName ?? "Board"}</h2>
				{currentBranch && (
					<button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-[#3a3a48] transition-colors">
						<GitBranch size={11} className="text-gray-600" />
						<span>{currentBranch}</span>
						<ChevronDown size={10} className="text-gray-600" />
					</button>
				)}
				<div className="flex-1" />
				<button
					onClick={() => {
						setCreateDialogMode("story");
						setCreateDialogOpen(true);
					}}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-[#3a3a48] transition-colors"
				>
					<Layers size={12} />
					New Story
				</button>
				<button
					onClick={() => {
						setCreateDialogMode("task");
						setCreateDialogOpen(true);
					}}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-[#3a3a48] transition-colors"
				>
					<Plus size={12} />
					New Task
				</button>
				{runSession.status === "running" && runSession.cardId === null ? (
					<button
						onClick={handleStop}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500 text-xs text-white hover:bg-red-600 transition-colors"
					>
						<Square size={11} className="fill-current" />
						Stop
					</button>
				) : (
					<button
						onClick={handleRunBase}
						disabled={runSession.status === "running"}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#7c6aff] text-xs text-white hover:bg-[#6a5ae0] disabled:opacity-50 transition-colors"
					>
						<Play size={11} className="fill-current" />
						Run
					</button>
				)}
				<button onClick={onOpenAgent} className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors">
					<MessageSquare size={15} />
				</button>
				<button onClick={onOpenSettings} className="p-1.5 text-gray-600 hover:text-gray-400 transition-colors">
					<Settings size={15} />
				</button>
			</div>

			<div className="flex-1 overflow-x-auto flex flex-col">
				<DragDropContext onDragEnd={handleDragEnd}>
					<div className="flex p-4 flex-1 w-max">
						{state.board.columns.map((column, idx) => {
							const cards = column.taskIds
								.map((id) => state.board.cards[id])
								.filter((c): c is RuntimeBoardCard => Boolean(c));
							return (
								<div key={column.id} className="flex">
									{idx > 0 && <div className="w-px bg-[#2a2a35] self-stretch mx-2 shrink-0" />}
									<KanbanColumn
										column={column}
										cards={cards}
										allCards={state.board.cards}
										workflows={state.projectConfig.workflows}
										workspaceId={workspaceId}
										runningCardId={runSession.status === "running" ? runSession.cardId : null}
										onCardClick={(card) => openCard(card.id)}
										onCardEdit={openEditDialog}
										onCardDelete={handleCardDelete}
										onCardToggleReady={handleToggleReady}
										onCardRun={handleRun}
										onCardStop={handleStop}
										onAddCard={() => {
											setCreateDialogMode("task");
											setCreateDialogOpen(true);
										}}
									/>
								</div>
							);
						})}
					</div>
				</DragDropContext>
			</div>

			{detailCard && (
				<CardDetailPanel
					card={detailCard}
					workspaceId={workspaceId}
					allCards={state.board.cards}
					workflowSlots={
						(
							state.projectConfig.workflows.find((w) => w.id === detailCard.workflowId) ??
							state.projectConfig.workflows.find((w) => w.isDefault) ??
							state.projectConfig.workflows[0]
						)?.slots
					}
					projectName={projectName}
					onClose={closeCard}
					onRefresh={onRefresh}
					onDeleteCard={onDeleteCard}
				/>
			)}

			<CreateTaskDialog
				open={createDialogOpen}
				onClose={() => setCreateDialogOpen(false)}
				initialMode={createDialogMode}
				workspaceId={workspaceId}
				allCards={state.board.cards}
				workflows={state.projectConfig.workflows}
				onRefresh={onRefresh}
				navigate={(path) => navigate(path)}
			/>

			{editDialogCard && (
				<EditTaskDialog
					card={editDialogCard}
					workspaceId={workspaceId}
					allCards={state.board.cards}
					workflows={state.projectConfig.workflows}
					onRefresh={onRefresh}
					onClose={() => setEditDialogCard(null)}
				/>
			)}
		</div>
	);
}
