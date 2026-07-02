import { ConfirmDialog, Menu, MenuTrigger, toast } from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import {
	Bot,
	ChevronDown,
	GitBranch,
	GitPullRequest,
	Layers,
	ListChecks,
	OctagonX,
	Play,
	Plus,
	Square,
	Upload,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRead, useWrite } from "@/runtime/api-client";
import { useRunSession } from "@/stores/run-session-store";
import { isCardRunning } from "../helpers";
import { CardDetailPanel } from "./CardDetailPanel";
import { ImportDialog } from "./ImportDialog";
import { CreateTaskDialog, EditTaskDialog } from "./TaskDialog";
import { KanbanColumn } from "./KanbanColumn";

interface KanbanBoardProps {
	state: RuntimeWorkspaceStateResponse;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
	projectName?: string;
}

export function KanbanBoard({ state, onRefresh, onDeleteCard, projectName }: KanbanBoardProps) {
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

	const columnCount = (columnId: RuntimeBoardColumnId) =>
		state.board.columns.find((c) => c.id === columnId)?.taskIds.length ?? 0;
	const runningCount = Object.values(state.board.cards).filter(isCardRunning).length;
	const automationActive = runningCount > 0;

	const openCard = (id: string) => navigate(`/${encodeURIComponent(workspaceId)}/board/${encodeURIComponent(id)}`);
	const closeCard = () => navigate(`/${encodeURIComponent(workspaceId)}/board`);

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
					onRefresh();
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
		<div className="flex-1 overflow-hidden flex flex-col relative bg-whip-bg">
			<div className="flex items-center gap-4 px-6 py-0 h-[82px] border-b border-whip-border-soft shrink-0">
				{/* Title block */}
				<div className="flex flex-col gap-[7px] w-[300px] shrink-0">
					<h2 className="text-[20px] font-semibold text-whip-text truncate">{projectName ?? "Board"}</h2>
					<div className="flex items-center gap-2">
						{currentBranch && (
							<span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-whip-panel border border-whip-border text-xs text-whip-muted">
								<GitBranch size={11} className="text-whip-faint" />
								<span>{currentBranch}</span>
							</span>
						)}
						{state.projectConfig.deliveryMode === "pr" && (
							<span
								title="Tasks that pass review open a pull request"
								className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#8b5cf6]/10 border border-[#8b5cf6]/40 text-xs text-[#8b5cf6]"
							>
								<GitPullRequest size={11} />
								Auto PR
							</span>
						)}
						{state.projectConfig.deliveryMode === "yolo" && (
							<span
								title="Tasks that pass review merge into the base branch and push — no PR, no approval"
								className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#eab308]/10 border border-[#eab308]/40 text-xs text-[#eab308]"
							>
								<Zap size={11} className="fill-current" />
								YOLO
							</span>
						)}
					</div>
				</div>

				{/* Board summary */}
				<div className="flex items-center gap-2.5">
					<span className="flex items-center gap-1.5 px-2.5 py-[7px] rounded-md bg-whip-panel border border-whip-border">
						<span className="size-[7px] rounded-full bg-[#eab308]" />
						<span className="text-xs text-whip-muted">Ready</span>
						<span className="text-xs font-mono font-bold text-whip-text">{columnCount("ready_for_review")}</span>
					</span>
					<span className="flex items-center gap-1.5 px-2.5 py-[7px] rounded-md bg-whip-panel border border-whip-border">
						<span className="size-[7px] rounded-full bg-whip-text" />
						<span className="text-xs text-whip-muted">Running</span>
						<span className="text-xs font-mono font-bold text-whip-text">{runningCount}</span>
					</span>
					<span className="flex items-center gap-1.5 px-2.5 py-[7px] rounded-md bg-whip-panel border border-whip-border">
						<span className="size-[7px] rounded-full bg-[#ff3b4d]" />
						<span className="text-xs text-whip-muted">Blocked</span>
						<span className="text-xs font-mono font-bold text-whip-text">{columnCount("blocked")}</span>
					</span>
				</div>

				<div className="flex-1" />

				{/* Header actions */}
				<Menu
					placement="bottom-end"
					menuClassName="w-[250px] p-2 flex flex-col gap-1 bg-whip-panel border border-whip-border rounded-lg"
				>
					<MenuTrigger>
						{({ toggleMenu }) => (
							<button
								onClick={toggleMenu}
								className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-whip-panel border border-whip-border hover:border-whip-border-hover transition-colors"
							>
								<Bot size={13} className="text-whip-muted" />
								<span className="text-xs font-medium text-whip-muted">Automation</span>
								<span className={`size-1.5 rounded-full ${automationActive ? "bg-whip-text" : "bg-[#22c55e]"}`} />
								<span className="text-xs font-semibold text-whip-text">{automationActive ? "Running" : "Idle"}</span>
								<ChevronDown size={12} className="text-whip-faint" />
							</button>
						)}
					</MenuTrigger>
					<div className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-whip-bg">
						<span className={`size-[7px] rounded-full ${automationActive ? "bg-whip-text" : "bg-[#22c55e]"}`} />
						<span className="text-xs font-semibold text-whip-text">
							{runningCount > 0 ? `${runningCount} agent${runningCount === 1 ? "" : "s"} running` : "No agents running"}
						</span>
					</div>
					<button
						onClick={handleResumeAll}
						title="Mark every Todo task Ready for Dev"
						className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-whip-muted hover:bg-whip-panel-2 transition-colors text-left"
					>
						<ListChecks size={14} />
						Resume all Todo tasks
					</button>
					<button
						onClick={handleStopAll}
						title="Stop all agents and park tasks in Todo"
						className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-[#ff9aa4] bg-[#ff3b4d]/10 hover:bg-[#ff3b4d]/20 transition-colors text-left"
					>
						<OctagonX size={14} />
						Stop all agents
					</button>
				</Menu>

				<Menu
					placement="bottom-end"
					menuClassName="w-[150px] p-2 flex flex-col gap-1 bg-whip-panel border border-whip-border rounded-lg"
				>
					<MenuTrigger>
						{({ toggleMenu }) => (
							<button
								onClick={toggleMenu}
								className="flex items-center gap-2 px-3 py-2 rounded-md bg-whip-panel border border-whip-border hover:border-whip-border-hover transition-colors"
							>
								<Plus size={13} className="text-whip-text" />
								<span className="text-xs font-bold text-whip-text">Create</span>
								<ChevronDown size={12} className="text-whip-muted" />
							</button>
						)}
					</MenuTrigger>
					<button
						onClick={() => {
							setCreateDialogMode("task");
							setCreateDialogOpen(true);
						}}
						className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-whip-accent/12 text-xs font-semibold text-whip-text text-left"
					>
						<Plus size={14} />
						New Task
					</button>
					<button
						onClick={() => {
							setCreateDialogMode("story");
							setCreateDialogOpen(true);
						}}
						className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-whip-muted hover:bg-whip-panel-2 transition-colors text-left"
					>
						<Layers size={14} />
						New Story
					</button>
					<button
						onClick={() => setImportDialogOpen(true)}
						className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-whip-muted hover:bg-whip-panel-2 transition-colors text-left"
					>
						<Upload size={14} />
						Import JSON
					</button>
				</Menu>

				{hasStartCommand && (
					<>
						{runSession.status === "running" && runSession.cardId === null ? (
							<button
								onClick={handleStop}
								className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#ff3b4d] text-xs font-bold text-white hover:bg-[#e0293a] transition-colors"
							>
								<Square size={11} className="fill-current" />
								Stop
							</button>
						) : (
							<button
								onClick={handleRunBase}
								disabled={runSession.status === "running"}
								className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-whip-accent text-xs font-bold text-whip-accent-text hover:opacity-90 disabled:opacity-50 transition-colors"
							>
								<Play size={11} className="fill-current" />
								Run
							</button>
						)}
					</>
				)}
			</div>

			<div className="flex-1 overflow-x-auto flex flex-col">
				<DragDropContext onDragEnd={handleDragEnd}>
					<div className="flex px-[18px] pt-[18px] pb-5 flex-1 w-max">
						{state.board.columns.map((column, idx) => {
							const cards = column.taskIds
								.map((id) => state.board.cards[id])
								.filter((c): c is RuntimeBoardCard => Boolean(c));
							return (
								<div key={column.id} className="flex">
									{idx > 0 && <div className="w-px bg-whip-border-soft self-stretch mx-2 shrink-0" />}
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
