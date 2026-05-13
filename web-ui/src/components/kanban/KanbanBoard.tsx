import { Button, ConfirmDialog, Dialog, Input, Select, SelectOption, Switch, Textarea, toast } from "@geckoui/geckoui";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import type {
	Workflow,
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeWorkspaceStateResponse,
} from "@runtime-contract";
import { Bot, Layers, Paperclip, Plus, Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { trpc } from "@/runtime/trpc-client";
import { useRunSession } from "@/stores/run-session-store";
import { BranchSelect } from "@/components/BranchSelect";
import { CardDetailPanel } from "./CardDetailPanel";
import { CreateStoryDrawer } from "./CreateStoryDrawer";
import { KanbanColumn } from "./KanbanColumn";
import { deriveBranchName } from "@/utils/branch";

interface KanbanBoardProps {
	state: RuntimeWorkspaceStateResponse;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
	onOpenSettings: () => void;
	onOpenAgent: () => void;
}

const DIALOG_CLASS = "w-full";

export function KanbanBoard({ state, onRefresh, onDeleteCard, onOpenSettings, onOpenAgent }: KanbanBoardProps) {
	const navigate = useNavigate();
	const { workspaceId: urlWorkspaceId, cardId: detailCardId } = useParams<{ workspaceId: string; cardId?: string }>();
	const workspaceId = urlWorkspaceId!;
	const { session: runSession, start: startRun, stop: stopRun } = useRunSession(workspaceId);

	const handleRun = async (cardId: string) => {
		try {
			await startRun(cardId);
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
	const [storyDrawerOpen, setStoryDrawerOpen] = useState(false);

	const openCard = (id: string) =>
		navigate(`/${encodeURIComponent(workspaceId)}/board/${encodeURIComponent(id)}`, { replace: true });
	const closeCard = () => navigate(`/${encodeURIComponent(workspaceId)}/board`, { replace: true });

	const handleCardDelete = (card: RuntimeBoardCard) => {
		ConfirmDialog.show({
			title: "Delete task?",
			content: `"${card.title}" will be permanently deleted.`,
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

	const openCreateDialog = () => {
		Dialog.show({
			className: DIALOG_CLASS,
			content: ({ dismiss }) => (
				<CreateCardContent
					workspaceId={workspaceId}
					allCards={state.board.cards}
					workflows={state.projectConfig.workflows}
					dismiss={dismiss}
					onRefresh={onRefresh}
				/>
			),
		});
	};

	const openEditDialog = (card: RuntimeBoardCard) => {
		Dialog.show({
			className: DIALOG_CLASS,
			content: ({ dismiss }) => (
				<EditCardContent
					workspaceId={workspaceId}
					card={card}
					allCards={state.board.cards}
					workflows={state.projectConfig.workflows}
					dismiss={dismiss}
					onRefresh={onRefresh}
				/>
			),
		});
	};

	const handleMoveAllToReady = () => {
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
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
				<h2 className="text-sm font-medium text-gray-300">Board</h2>
				<div className="flex items-center gap-2">
					<Button size="sm" variant="ghost" onClick={handleMoveAllToReady}>
						Todo → Ready
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setStoryDrawerOpen(true)}>
						<Layers size={13} className="mr-1" /> New story
					</Button>
					<Button size="sm" variant="outlined" onClick={openCreateDialog}>
						<Plus size={13} className="mr-1" /> New task
					</Button>
					<Button size="sm" variant="ghost" onClick={onOpenSettings}>
						<Settings size={14} />
					</Button>
					<Button size="sm" variant="ghost" onClick={onOpenAgent}>
						<Bot size={14} />
					</Button>
				</div>
			</div>

			<div className="flex-1 overflow-x-auto flex flex-col">
				<DragDropContext onDragEnd={handleDragEnd}>
					<div className="flex gap-3 p-4 flex-1 w-max">
						{state.board.columns.map((column) => {
							const cards = column.taskIds
								.map((id) => state.board.cards[id])
								.filter((c): c is RuntimeBoardCard => Boolean(c));
							return (
								<KanbanColumn
									key={column.id}
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
								/>
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
					onClose={closeCard}
					onRefresh={onRefresh}
					onDeleteCard={onDeleteCard}
				/>
			)}

			<CreateStoryDrawer
				open={storyDrawerOpen}
				onClose={() => setStoryDrawerOpen(false)}
				workspaceId={workspaceId}
				allCards={state.board.cards}
				workflows={state.projectConfig.workflows}
				onRefresh={onRefresh}
			/>
		</div>
	);
}

const COLUMN_BADGE: Record<string, string> = {
	todo: "text-gray-400 bg-gray-700",
	in_progress: "text-blue-400 bg-blue-400/10",
	reopened: "text-orange-400 bg-orange-400/10",
	ready_for_review: "text-green-400 bg-green-400/10",
	blocked: "text-red-400 bg-red-400/10",
	done: "text-emerald-400 bg-emerald-400/10",
};

const COLUMN_LABEL: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

interface PendingImage {
	dataUrl: string | null;
	file: File;
}

async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
	const { uploadAttachmentFile } = await import("@/runtime/attachments");
	const results = [];
	for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
	return results;
}

function ImagePicker({
	pending,
	onChange,
	onPaste,
}: {
	pending: PendingImage[];
	onChange: (imgs: PendingImage[]) => void;
	onPaste?: (e: React.ClipboardEvent) => void;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const addFiles = (files: FileList | File[]) => {
		Array.from(files).forEach((file) => {
			if (file.type.startsWith("image/")) {
				const reader = new FileReader();
				reader.onload = (ev) => onChange([...pending, { dataUrl: ev.target?.result as string, file }]);
				reader.readAsDataURL(file);
			} else {
				onChange([...pending, { dataUrl: null, file }]);
			}
		});
	};
	return (
		<div>
			<input
				ref={ref}
				type="file"
				accept="*/*"
				multiple
				className="hidden"
				onChange={(e) => {
					if (e.target.files) addFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			{pending.length > 0 && (
				<div className="flex flex-wrap gap-2 mb-2 mt-1">
					{pending.map((img, i) => (
						<div key={i} className="relative group">
							{img.dataUrl ? (
								<img
									src={img.dataUrl}
									alt={img.file.name}
									className="h-14 w-14 object-cover rounded border border-gray-700"
								/>
							) : (
								<div className="h-14 w-14 flex flex-col items-center justify-center rounded border border-gray-700 bg-gray-800 gap-1">
									<Paperclip size={14} className="text-gray-400" />
									<span className="text-[9px] text-gray-400 truncate w-12 text-center px-1">{img.file.name}</span>
								</div>
							)}
							<button
								type="button"
								onClick={() => onChange(pending.filter((_, j) => j !== i))}
								className="absolute -top-1 -right-1 size-4 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
							>
								<X size={9} className="text-gray-300" />
							</button>
						</div>
					))}
				</div>
			)}
			<button
				type="button"
				onClick={() => ref.current?.click()}
				className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors mt-1"
			>
				<Paperclip size={12} /> Attach file
			</button>
		</div>
	);
}

function CreateCardContent({
	workspaceId,
	allCards,
	workflows,
	dismiss,
	onRefresh,
}: {
	workspaceId: string;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	dismiss: () => void;
	onRefresh: () => void;
}) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const defaultWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [priority, setPriority] = useState<string>("");
	const [readyForDev, setReadyForDev] = useState(true);
	const [dependsOn, setDependsOn] = useState<string[]>([]);
	const [baseRef, setBaseRef] = useState<string>("");
	const [workflowId, setWorkflowId] = useState<string>(defaultWorkflow?.id ?? "");
	const [branches, setBranches] = useState<string[]>([]);
	const [branchName, setBranchName] = useState<string>("");
	const [branchNameEdited, setBranchNameEdited] = useState(false);
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
			const card = await trpc.cards.create.mutate({
				workspaceId,
				title: title.trim(),
				description,
				priority: (priority as "urgent" | "high" | "medium" | "low" | undefined) || undefined,
				readyForDev: readyForDev || undefined,
				dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
				baseRef: baseRef || undefined,
				workflowId: workflowId || undefined,
				branchName: branchName.trim() || undefined,
			});
			if (pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, card.id, pendingImages);
				await trpc.cards.update.mutate({ workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 });
			}
			dismiss();
			onRefresh();
		} catch {
			toast.error("Failed to create task");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div>
			<h3 className="text-base font-semibold text-gray-100 mb-4">New Task</h3>

			<div className="space-y-3">
				<div>
					<label className="text-xs text-gray-400 block mb-1">Title</label>
					<Input
						autoFocus
						value={title}
						onChange={(e) => {
							const v = e.target.value;
							setTitle(v);
							if (!branchNameEdited) {
								setBranchName(deriveBranchName(v));
							}
						}}
						onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCreate()}
						placeholder="Task title..."
					/>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Branch Name</label>
					<Input
						value={branchName}
						onChange={(e) => {
							setBranchName(e.target.value);
							setBranchNameEdited(true);
						}}
						placeholder="feat/auto-generated-from-title"
					/>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Description</label>
					<Textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						onPaste={(e) => {
							const files = Array.from(e.clipboardData.files);
							if (files.length) {
								e.preventDefault();
								files.forEach((file) => {
									if (file.type.startsWith("image/")) {
										const r = new FileReader();
										r.onload = (ev) => setPendingImages((p) => [...p, { dataUrl: ev.target?.result as string, file }]);
										r.readAsDataURL(file);
									} else {
										setPendingImages((p) => [...p, { dataUrl: null, file }]);
									}
								});
							}
						}}
						placeholder="Describe what needs to be done..."
						rows={4}
					/>
					<ImagePicker pending={pendingImages} onChange={setPendingImages} />
				</div>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="text-xs text-gray-400 block mb-1">Base Branch</label>
						<BranchSelect branches={branches} value={baseRef} onChange={setBaseRef} />
					</div>
					<div>
						<label className="text-xs text-gray-400 block mb-1">Workflow</label>
						<Select value={workflowId} onChange={(v) => setWorkflowId(v as string)} placeholder="Default">
							{taskWorkflows.map((w) => (
								<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
							))}
						</Select>
					</div>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Priority</label>
					<Select value={priority} onChange={(v) => setPriority(v as string)} placeholder="No priority" clearable>
						<SelectOption value="urgent" label="Urgent" />
						<SelectOption value="high" label="High" />
						<SelectOption value="medium" label="Medium" />
						<SelectOption value="low" label="Low" />
					</Select>
				</div>
				<div>
					<label className="text-xs text-gray-400 block mb-1">Depends on</label>
					<Select multiple value={dependsOn} onChange={(v) => setDependsOn(v)} placeholder="None" filterable clearable>
						{Object.values(allCards)
							.filter((c) => c.columnId !== "done")
							.map((c) => (
								<SelectOption
									key={c.id}
									value={c.id}
									label={c.title}
									hideCheckIcon
									className={({ selected }) => (selected ? "bg-gray-700" : "")}
								>
									<div className="flex items-center justify-between w-full gap-2 min-w-0">
										<span className="truncate text-sm">{c.title}</span>
										<span
											className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700"}`}
										>
											{COLUMN_LABEL[c.columnId] ?? c.columnId}
										</span>
									</div>
								</SelectOption>
							))}
					</Select>
				</div>
				<div className="flex items-center justify-between py-1">
					<div>
						<label className="text-xs text-gray-400 block">Ready for agent</label>
						<p className="text-xs text-gray-600">Agent will pick this up automatically when autonomous mode is on</p>
					</div>
					<Switch checked={readyForDev} onChange={setReadyForDev} />
				</div>
			</div>

			<div className="flex gap-2 mt-5 justify-end">
				<Button variant="ghost" onClick={dismiss}>
					Cancel
				</Button>
				<Button onClick={handleCreate} disabled={!title.trim() || loading}>
					{loading ? "Creating..." : "Create"}
				</Button>
			</div>
		</div>
	);
}

function EditCardContent({
	workspaceId,
	card,
	allCards,
	workflows,
	dismiss,
	onRefresh,
}: {
	workspaceId: string;
	card: RuntimeBoardCard;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	dismiss: () => void;
	onRefresh: () => void;
}) {
	const isStory = card.type === "story";
	const isSubtask = card.type === "subtask";

	const canEditBranch = !isStory && !card.worktreePath;

	const [title, setTitle] = useState(card.title);
	const [description, setDescription] = useState(card.description);
	const [existingAttachments, setExistingAttachments] = useState(card.descriptionAttachments ?? []);
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [priority, setPriority] = useState<string>(card.priority ?? "");
	const [dependsOn, setDependsOn] = useState<string[]>(card.dependsOn ?? []);
	const [workflowId, setWorkflowId] = useState<string>(card.workflowId ?? "");
	const [branchName, setBranchName] = useState<string>(card.branchName ?? "");
	const [branchNameEdited, setBranchNameEdited] = useState(!!card.branchName);
	const [loading, setLoading] = useState(false);

	// Stories use story workflows; tasks/subtasks use task workflows
	const availableWorkflows = isStory ? workflows.filter((w) => w.forStory) : workflows.filter((w) => !w.forStory);

	// For subtasks: exclude story cards from dependsOn options (avoids circular deps)
	// For stories: the dependsOn list IS the subtasks — don't show in edit to avoid confusion
	const depsCardPool = Object.values(allCards).filter((c) => {
		if (c.id === card.id || c.columnId === "done") return false;
		if (isSubtask) return c.type !== "story";
		return true;
	});

	const handleSave = async () => {
		if (!title.trim()) return;
		setLoading(true);
		try {
			const newUploads = pendingImages.length > 0 ? await uploadImages(workspaceId, card.id, pendingImages) : [];
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				title: title.trim(),
				description,
				descriptionAttachments: [...existingAttachments, ...newUploads],
				priority: (priority as "urgent" | "high" | "medium" | "low" | undefined) || undefined,
				dependsOn: isStory ? undefined : dependsOn,
				workflowId: workflowId || undefined,
				branchName: canEditBranch ? branchName.trim() || undefined : undefined,
				revision: 0,
			});
			dismiss();
			onRefresh();
		} catch {
			toast.error(`Failed to update ${isStory ? "story" : isSubtask ? "subtask" : "task"}`);
		} finally {
			setLoading(false);
		}
	};

	const dialogTitle = isStory ? "Edit Story" : isSubtask ? "Edit Subtask" : "Edit Task";

	return (
		<div>
			<h3 className="text-base font-semibold text-gray-100 mb-4">{dialogTitle}</h3>

			<div className="space-y-3">
				<div>
					<label className="text-xs text-gray-400 block mb-1">Title</label>
					<Input
						autoFocus
						value={title}
						onChange={(e) => {
							const v = e.target.value;
							setTitle(v);
							if (canEditBranch && !branchNameEdited) {
								setBranchName(deriveBranchName(v));
							}
						}}
						onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSave()}
					/>
				</div>
				{canEditBranch && (
					<div>
						<label className="text-xs text-gray-400 block mb-1">Branch Name</label>
						<Input
							value={branchName}
							onChange={(e) => {
								setBranchName(e.target.value);
								setBranchNameEdited(true);
							}}
							placeholder="feat/auto-generated-from-title"
						/>
					</div>
				)}
				<div>
					<label className="text-xs text-gray-400 block mb-1">Description</label>
					<Textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						onPaste={(e) => {
							const files = Array.from(e.clipboardData.files);
							if (files.length) {
								e.preventDefault();
								files.forEach((file) => {
									if (file.type.startsWith("image/")) {
										const r = new FileReader();
										r.onload = (ev) => setPendingImages((p) => [...p, { dataUrl: ev.target?.result as string, file }]);
										r.readAsDataURL(file);
									} else {
										setPendingImages((p) => [...p, { dataUrl: null, file }]);
									}
								});
							}
						}}
						rows={4}
					/>
					{existingAttachments.length > 0 && (
						<div className="flex flex-wrap gap-1.5 mt-1">
							{existingAttachments.map((att, i) => (
								<span
									key={i}
									className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5"
								>
									<Paperclip size={10} className="shrink-0" /> {att.name}
									<button
										type="button"
										onClick={() => setExistingAttachments((a) => a.filter((_, j) => j !== i))}
										className="text-gray-600 hover:text-red-400 transition-colors"
									>
										<X size={9} />
									</button>
								</span>
							))}
						</div>
					)}
					<ImagePicker pending={pendingImages} onChange={setPendingImages} />
				</div>
				<div className="grid grid-cols-2 gap-3">
					<div>
						<label className="text-xs text-gray-400 block mb-1">Priority</label>
						<Select value={priority} onChange={(v) => setPriority(v as string)} placeholder="No priority" clearable>
							<SelectOption value="urgent" label="Urgent" />
							<SelectOption value="high" label="High" />
							<SelectOption value="medium" label="Medium" />
							<SelectOption value="low" label="Low" />
						</Select>
					</div>
					<div>
						<label className="text-xs text-gray-400 block mb-1">{isStory ? "Orch Workflow" : "Workflow"}</label>
						<Select value={workflowId} onChange={(v) => setWorkflowId(v as string)} placeholder="Default">
							{availableWorkflows.map((w) => (
								<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
							))}
						</Select>
					</div>
				</div>
				{!isStory && (
					<div>
						<label className="text-xs text-gray-400 block mb-1">Depends on</label>
						<Select
							multiple
							value={dependsOn}
							onChange={(v) => setDependsOn(v as string[])}
							placeholder="None"
							filterable
							clearable
						>
							{depsCardPool.map((c) => (
								<SelectOption
									key={c.id}
									value={c.id}
									label={c.title}
									hideCheckIcon
									className={({ selected }: { selected: boolean }) => (selected ? "bg-gray-700" : "")}
								>
									<div className="flex items-center justify-between w-full gap-2 min-w-0">
										<span className="truncate text-sm">{c.title}</span>
										<span
											className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700"}`}
										>
											{COLUMN_LABEL[c.columnId] ?? c.columnId}
										</span>
									</div>
								</SelectOption>
							))}
						</Select>
					</div>
				)}
			</div>

			<div className="flex gap-2 mt-5 justify-end">
				<Button variant="ghost" onClick={dismiss}>
					Cancel
				</Button>
				<Button onClick={handleSave} disabled={!title.trim() || loading}>
					{loading ? "Saving..." : "Save"}
				</Button>
			</div>
		</div>
	);
}
