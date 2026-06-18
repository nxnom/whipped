import { ConfirmDialog, toast } from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import {
	ChevronDown,
	GitBranch,
	GitPullRequest,
	Layers,
	ListChecks,
	MessageSquare,
	OctagonX,
	Play,
	Plus,
	Settings,
	Square,
	Upload,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRead, useWrite } from "@/runtime/api-client";
import { useRunSession } from "@/stores/run-session-store";
import { CardDetailPanel } from "./CardDetailPanel";
import { ImportDialog } from "./ImportDialog";
import { CreateTaskDialog, EditTaskDialog } from "./TaskDialog";
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
	const hasStartCommand = Boolean(state.projectConfig.startCommand);
	const detailCard = detailCardId ? (state.board.cards[detailCardId] ?? null) : null;
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createDialogMode, setCreateDialogMode] = useState<"task" | "story">("task");
	const [importDialogOpen, setImportDialogOpen] = useState(false);
	const [editDialogCard, setEditDialogCard] = useState<RuntimeBoardCard | null>(null);

	const { data: branchesData } = useRead((api) => api("cards/branches").GET({ query: { workspaceId } }));
	const { trigger: deleteCard } = useWrite((api) => api("cards/:id").DELETE());
	const { trigger: updateCard } = useWrite((api) => api("cards/:id").PATCH());
	const { trigger: moveCard } = useWrite((api) => api("cards/move").POST());
	const { trigger: stopAll } = useWrite((api) => api("cards/stop-all").POST());
	const { trigger: resumeAll } = useWrite((api) => api("cards/resume-all").POST());

	const currentBranch = branchesData?.defaultBranch ?? "";

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
					await deleteCard({ params: { id: card.id }, body: { workspaceId } });
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
			await updateCard({
				params: { id: card.id },
				body: {
					workspaceId,
					cardId: card.id,
					readyForDev: !card.readyForDev,
					revision: 0,
				},
			});
			onRefresh();
		} catch {
			toast.error("Failed to update task");
		}
	};

	const openEditDialog = (card: RuntimeBoardCard) => {
		setEditDialogCard(card);
	};

	const handleStopAll = () => {
		ConfirmDialog.show({
			title: "Stop all automation?",
			content:
				"Kills every running agent, moves In Progress and Reopened tasks back to Todo, and unmarks Ready for Dev so nothing is picked up. Worktrees are kept, so Resume continues prior work.",
			confirmButtonLabel: "Stop All",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				try {
					const res = await stopAll({ body: { workspaceId } });
					if (res.error) throw res.error;
					onRefresh();
					const n = res.data?.stoppedCardIds.length ?? 0;
					toast.success(n > 0 ? `Stopped ${n} task${n === 1 ? "" : "s"} → Todo` : "Automation paused");
				} catch {
					toast.error("Failed to stop all");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleResumeAll = async () => {
		try {
			const res = await resumeAll({ body: { workspaceId } });
			if (res.error) throw res.error;
			onRefresh();
			const n = res.data?.resumedCardIds.length ?? 0;
			toast.success(n > 0 ? `Resumed ${n} task${n === 1 ? "" : "s"}` : "No Todo tasks to resume");
		} catch {
			toast.error("Failed to resume");
		}
	};

	const handleDragEnd = async (result: DropResult) => {
		if (!result.destination) return;
		if (
			result.destination.droppableId === result.source.droppableId &&
			result.destination.index === result.source.index
		)
			return;

		try {
			await moveCard({
				body: {
					workspaceId,
					cardId: result.draggableId,
					targetColumnId: result.destination.droppableId as RuntimeBoardColumnId,
					targetIndex: result.destination.index,
					revision: state.revision,
				},
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
				{state.projectConfig.deliveryMode === "pr" && (
					<span
						title="Tasks that pass review open a pull request"
						className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#7c6aff]/15 border border-[#7c6aff]/40 text-xs text-[#b3a8ff]"
					>
						<GitPullRequest size={11} />
						Auto PR
					</span>
				)}
				{state.projectConfig.deliveryMode === "yolo" && (
					<span
						title="Tasks that pass review merge into the base branch and push — no PR, no approval"
						className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/40 text-xs text-amber-300"
					>
						<Zap size={11} className="fill-current" />
						YOLO
					</span>
				)}
				<div className="flex-1" />
				<button
					onClick={handleResumeAll}
					title="Mark every Todo task Ready for Dev"
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-[#3a3a48] transition-colors"
				>
					<ListChecks size={12} />
					Resume
				</button>
				<button
					onClick={handleStopAll}
					title="Stop all agents and park tasks in Todo"
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-red-500/60 hover:text-red-400 transition-colors"
				>
					<OctagonX size={12} />
					Stop All
				</button>
				<button
					onClick={() => setImportDialogOpen(true)}
					title="Bulk import tickets from JSON"
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1a1a1f] border border-[#2a2a35] text-xs text-gray-500 hover:border-[#3a3a48] transition-colors"
				>
					<Upload size={12} />
					Import
				</button>
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
				{hasStartCommand && (
					<>
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
					</>
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
										runningCardId={runSession.status === "running" ? runSession.cardId : null}
										hasStartCommand={hasStartCommand}
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
					hasStartCommand={hasStartCommand}
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

			<ImportDialog
				open={importDialogOpen}
				onClose={() => setImportDialogOpen(false)}
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
