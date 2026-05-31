import { RHFTextarea } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { CreateStoryForm, CreateTaskForm, SubtaskDraftForm } from "@runtime-validation/card";
import { createStoryFormSchema, createTaskFormSchema } from "@runtime-validation/card";
import { Monitor, Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useRead } from "@/runtime/api-client";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";
import { CreateSubtaskDialog } from "./CreateSubtaskDialog";
import { CreateTaskConfigSidebar } from "./CreateTaskConfigSidebar";
import { addFilesFromClipboard } from "./helpers";
import { ImagePicker } from "./ImagePicker";
import { StorySubtaskList } from "./StorySubtaskList";
import type { Mode, PendingImage, SubtaskDraft } from "./types";
import { useTaskSubmit } from "./useTaskSubmit";

interface CreateTaskDialogProps {
	open: boolean;
	onClose: () => void;
	initialMode?: Mode;
	workspaceId: string;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	onRefresh: () => void;
	navigate: (path: string) => void;
}

export function CreateTaskDialog({
	open,
	onClose,
	initialMode = "task",
	workspaceId,
	allCards,
	workflows,
	onRefresh,
	navigate,
}: CreateTaskDialogProps) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);
	const defaultTaskWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];
	const defaultStoryWorkflow = storyWorkflows.find((w) => w.isDefault) ?? storyWorkflows[0];

	const [mode, setMode] = useState<Mode>(initialMode);
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [readyForDev, setReadyForDev] = useState(true);
	const [branchNameEdited, setBranchNameEdited] = useState(false);
	const [loading, setLoading] = useState(false);

	// Subtask draft management (story mode). Held outside RHF's field array as the
	// authoritative source so the nested subtask dialog can read/write them and the
	// File-backed images travel with each draft.
	const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
	const [editingTempId, setEditingTempId] = useState<string | null>(null);

	const { data: branchesData } = useRead((api) => api("cards/branches").GET({ query: { workspaceId } }), {
		enabled: open,
	});
	const branches = branchesData?.branches ?? [];
	const defaultBranch = branchesData?.defaultBranch ?? "";

	const { submitTask, submitStory } = useTaskSubmit();

	const taskValues = useMemo<CreateTaskForm>(
		() => ({
			description: "",
			priority: "",
			baseRef: defaultBranch,
			workflowId: defaultTaskWorkflow?.id ?? "",
			branchName: "",
			dependsOn: "",
			waitsFor: [],
		}),
		[defaultBranch, defaultTaskWorkflow?.id],
	);

	const storyValues = useMemo<CreateStoryForm>(
		() => ({
			description: "",
			priority: "",
			baseRef: defaultBranch,
			workflowId: defaultStoryWorkflow?.id ?? "",
			subtasks: [],
		}),
		[defaultBranch, defaultStoryWorkflow?.id],
	);

	const taskMethods = useForm<CreateTaskForm>({ resolver: zodResolver(createTaskFormSchema), values: taskValues });
	const storyMethods = useForm<CreateStoryForm>({ resolver: zodResolver(createStoryFormSchema), values: storyValues });

	const { fields: subtaskFields, replace: replaceSubtasks } = useFieldArray({
		control: storyMethods.control,
		name: "subtasks",
	});

	// Image files for each subtask draft live outside the validated field array;
	// keyed by tempId so they survive add/remove/reorder.
	const [subtaskImages, setSubtaskImages] = useState<Record<string, PendingImage[]>>({});

	// Reset the active mode when the dialog (re)opens with a new initial mode.
	// Mode is local UI state, not a form value, so this reaction stays here.
	useEffect(() => {
		if (open) setMode(initialMode);
	}, [open, initialMode]);

	const isTask = mode === "task";
	const accentColor = isTask ? "#7c6aff" : "#a78bfa";
	const activeWorkflows = isTask ? taskWorkflows : storyWorkflows;

	const subtaskDrafts: SubtaskDraft[] = useMemo(
		() => subtaskFields.map((f) => ({ ...(f as SubtaskDraftForm), pendingImages: subtaskImages[f.tempId] ?? [] })),
		[subtaskFields, subtaskImages],
	);
	const editingSubtask = editingTempId ? subtaskDrafts.find((s) => s.tempId === editingTempId) : undefined;

	const taskDescription = useWatch({ control: taskMethods.control, name: "description" });
	const storyDescription = useWatch({ control: storyMethods.control, name: "description" });
	const activeDescription = isTask ? taskDescription : storyDescription;

	const handleClose = () => {
		setPendingImages([]);
		setBranchNameEdited(false);
		setEditingTempId(null);
		setSubtaskDialogOpen(false);
		setReadyForDev(true);
		setSubtaskImages({});
		taskMethods.reset(taskValues);
		storyMethods.reset(storyValues);
		onClose();
	};

	const upsertSubtask = (subtask: SubtaskDraft) => {
		const { pendingImages: imgs, ...rest } = subtask;
		setSubtaskImages((prev) => ({ ...prev, [subtask.tempId]: imgs }));
		const current = storyMethods.getValues("subtasks");
		const idx = current.findIndex((s) => s.tempId === subtask.tempId);
		if (idx >= 0) {
			const next = [...current];
			next[idx] = rest;
			replaceSubtasks(next);
		} else {
			replaceSubtasks([...current, rest]);
		}
		setSubtaskDialogOpen(false);
		setEditingTempId(null);
	};

	const removeSubtask = (tempId: string) => {
		replaceSubtasks(storyMethods.getValues("subtasks").filter((s) => s.tempId !== tempId));
		setSubtaskImages((prev) => {
			const { [tempId]: _removed, ...rest } = prev;
			return rest;
		});
	};

	const handleCreateTask = taskMethods.handleSubmit(async (data) => {
		setLoading(true);
		try {
			const ok = await submitTask(data, { workspaceId, allCards, readyForDev, pendingImages });
			if (!ok) return;
			handleClose();
			onRefresh();
		} finally {
			setLoading(false);
		}
	});

	const handleCreateStory = storyMethods.handleSubmit(async (data) => {
		setLoading(true);
		const drafts = data.subtasks.map((s) => ({ ...s, pendingImages: subtaskImages[s.tempId] ?? [] }));
		try {
			const ok = await submitStory(data, { workspaceId, drafts, readyForDev, pendingImages });
			if (!ok) return;
			handleClose();
			onRefresh();
		} finally {
			setLoading(false);
		}
	});

	const openSubtaskDialog = (tempId: string | null) => {
		setEditingTempId(tempId);
		setSubtaskDialogOpen(true);
	};

	if (!open) return null;

	const activeMethods = isTask ? taskMethods : storyMethods;

	return (
		<>
			<FormProvider {...(activeMethods as unknown as UseFormReturn<FieldValues>)}>
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					{/* Backdrop */}
					<div className="absolute inset-0 bg-black/70" onClick={handleClose} />

					{/* Dialog */}
					<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
						{/* ── Left panel ── */}
						<div
							className="flex flex-col flex-1 overflow-hidden"
							onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}
						>
							{/* Header */}
							<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
								<span className="text-[15px] font-semibold text-[#f0f0f5]">{isTask ? "New Task" : "New Story"}</span>
								<div className="flex-1" />
								<button onClick={handleClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
									<X size={18} />
								</button>
							</div>

							{/* Editor area */}
							<div className="flex flex-col flex-1 min-h-0 px-8 py-4 gap-2">
								{/* Story: objective label */}
								{!isTask && (
									<div className="flex items-center gap-1.5 shrink-0">
										<span className="text-[11px] font-medium text-[#60607a]">Story Objective</span>
										<div className="flex-1" />
										<span className="text-[10px] text-[#4a4a5a]">The orchestrator will break this into subtasks</span>
									</div>
								)}

								{/* Description */}
								<RHFTextarea
									name="description"
									autoFocus
									onChange={(v) => {
										if (isTask && !branchNameEdited) {
											taskMethods.setValue("branchName", deriveBranchName((v ?? "").split("\n")[0] ?? ""));
										}
									}}
									placeholder="Describe what the agent should do..."
									className={classNames(
										"border-transparent! bg-transparent! text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7] shrink-0",
										isTask ? "flex-1 min-h-0" : "h-36",
									)}
								/>

								<ImagePicker pending={pendingImages} onChange={setPendingImages} />

								{/* Story: subtasks */}
								{!isTask && (
									<StorySubtaskList
										subtaskDrafts={subtaskDrafts}
										allCards={allCards}
										onAdd={() => openSubtaskDialog(null)}
										onEdit={(tempId) => openSubtaskDialog(tempId)}
										onRemove={removeSubtask}
									/>
								)}

								{/* Bottom attach buttons */}
								<div className="flex items-center gap-2 shrink-0 mt-auto pt-1">
									<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
										<Paperclip size={12} />
										Attach files
									</button>
									{isTask && (
										<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
											<Monitor size={12} />
											Screenshot
										</button>
									)}
								</div>
							</div>
						</div>

						{/* ── Right sidebar ── */}
						<CreateTaskConfigSidebar
							isTask={isTask}
							accentColor={accentColor}
							activeWorkflows={activeWorkflows}
							branches={branches}
							allCards={allCards}
							readyForDev={readyForDev}
							onToggleReadyForDev={() => setReadyForDev(!readyForDev)}
							onBranchNameEdited={() => setBranchNameEdited(true)}
							onNoWorkflows={() => {
								handleClose();
								navigate(`/${encodeURIComponent(workspaceId)}/settings/workflows`);
							}}
							onSubmit={isTask ? handleCreateTask : handleCreateStory}
							submitDisabled={
								loading ||
								!activeDescription?.trim() ||
								(!isTask && subtaskDrafts.length === 0) ||
								activeWorkflows.length === 0
							}
							submitLabel={loading ? "Creating..." : isTask ? "Create Task" : "Create Story"}
						/>
					</div>
				</div>
			</FormProvider>

			{/* Subtask dialog (story mode) */}
			{!isTask && (
				<CreateSubtaskDialog
					open={subtaskDialogOpen}
					onClose={() => {
						setSubtaskDialogOpen(false);
						setEditingTempId(null);
					}}
					onSave={upsertSubtask}
					allCards={allCards}
					workflows={workflows}
					draftSubtasks={subtaskDrafts}
					editingSubtask={editingSubtask}
					defaultBranch={defaultBranch}
					branches={branches}
				/>
			)}
		</>
	);
}
