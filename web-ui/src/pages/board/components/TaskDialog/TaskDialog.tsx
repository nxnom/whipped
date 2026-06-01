import { RHFError, RHFInput, RHFSelect, SelectOption, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { CreateStoryForm, CreateTaskForm, SubtaskDraftForm } from "@runtime-validation/card";
import { createStoryFormSchema, createTaskFormSchema, subtaskDraftSchema } from "@runtime-validation/card";
import { GitBranch, Plus, Workflow as WorkflowIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Controller, FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { DescriptionAttachmentEditor, type EditorAttachment } from "@/components/DescriptionAttachmentEditor";
import { useRead, useWrite } from "@/runtime/api-client";
import { normalizeAttachmentTokens, parseAttachmentTokenNumbers } from "@/utils/attachmentTokens";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";
import { COLUMN_BADGE, COLUMN_LABEL } from "./constants";
import { CreateTaskConfigSidebar } from "./CreateTaskConfigSidebar";
import { uploadImages } from "./helpers";
import { PriorityField } from "./PriorityField";
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
	const [attachments, setAttachments] = useState<EditorAttachment[]>([]);
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
		setAttachments([]);
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
			const { text: description, order } = normalizeAttachmentTokens(data.description);
			const orderedImages: PendingImage[] = order
				.map((n) => attachments.find((a) => a.n === n))
				.filter((a): a is EditorAttachment => Boolean(a?.file))
				.map((a) => ({ dataUrl: a.previewUrl, file: a.file as File, n: a.n }));
			const ok = await submitTask(
				{ ...data, description },
				{ workspaceId, allCards, readyForDev, pendingImages: orderedImages },
			);
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
			const { text: description, order } = normalizeAttachmentTokens(data.description);
			const orderedImages: PendingImage[] = order
				.map((n) => attachments.find((a) => a.n === n))
				.filter((a): a is EditorAttachment => Boolean(a?.file))
				.map((a) => ({ dataUrl: a.previewUrl, file: a.file as File, n: a.n }));
			const ok = await submitStory(
				{ ...data, description },
				{ workspaceId, drafts, readyForDev, pendingImages: orderedImages },
			);
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
			{/* Key by mode so the form subtree rebinds cleanly when switching
			    task↔story (the two share this provider but use different forms). */}
			<FormProvider key={mode} {...(activeMethods as unknown as UseFormReturn<FieldValues>)}>
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					{/* Backdrop */}
					<div className="absolute inset-0 bg-black/70" onClick={handleClose} />

					{/* Dialog */}
					<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
						{/* ── Left panel ── */}
						<div className="flex flex-col flex-1 overflow-hidden">
							{/* Header */}
							<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
								<span className="text-[15px] font-semibold text-[#f0f0f5]">{isTask ? "New Task" : "New Story"}</span>
								<div className="flex-1" />
								<button onClick={handleClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
									<X size={18} />
								</button>
							</div>

							{/* Editor area */}
							<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-2">
								{/* Story: objective label */}
								{!isTask && (
									<div className="flex items-center gap-1.5 shrink-0">
										<span className="text-[11px] font-medium text-[#60607a]">Story Objective</span>
										<div className="flex-1" />
										<span className="text-[10px] text-[#4a4a5a]">The orchestrator will break this into subtasks</span>
									</div>
								)}

								{/* Description + attachments */}
								<Controller
									name="description"
									render={({ field }) => (
										<DescriptionAttachmentEditor
											value={field.value ?? ""}
											onChange={(v) => {
												field.onChange(v);
												if (isTask && !branchNameEdited) {
													taskMethods.setValue("branchName", deriveBranchName(v.split("\n")[0] ?? ""));
												}
											}}
											attachments={attachments}
											setAttachments={setAttachments}
											className={isTask ? "flex-1 min-h-0" : "h-36"}
											placeholder="Describe what the agent should do..."
											autoFocus
										/>
									)}
								/>

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

// ── Edit an existing card (task / story / subtask) ──────────────────────────

interface EditTaskDialogProps {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	onClose: () => void;
	onRefresh: () => void;
}

export function EditTaskDialog({ card, workspaceId, allCards, workflows, onClose, onRefresh }: EditTaskDialogProps) {
	const isStory = card.type === "story";
	const isSubtask = card.type === "subtask";
	const canEditBranch = !isStory && !card.worktreePath;

	const [branchNameEdited, setBranchNameEdited] = useState(!!card.branchName);
	const [loading, setLoading] = useState(false);
	// Existing uploads + any newly added, unified under stable token numbers.
	const [attachments, setAttachments] = useState<EditorAttachment[]>(() =>
		(card.descriptionAttachments ?? []).map((att, i) => ({
			n: i + 1,
			name: att.name,
			previewUrl: null,
			uploaded: att,
		})),
	);

	const { trigger: updateCard } = useWrite((api) => api("cards/:id").PATCH());

	const values = useMemo<CreateTaskForm>(() => {
		// Auto-tokenize: make sure every existing attachment has a [Attachment #N]
		// reference so it shares one number space with newly added ones. Cards that
		// predate tokens get them appended; new-flow cards already have them.
		const existing = card.descriptionAttachments ?? [];
		const present = new Set(parseAttachmentTokenNumbers(card.description ?? ""));
		const missing = existing.map((_, i) => i + 1).filter((n) => !present.has(n));
		let description = card.description ?? "";
		if (missing.length) {
			const lead = description && !/\s$/.test(description) ? "\n\n" : "";
			description += lead + missing.map((n) => `[Attachment #${n}]`).join(" ");
		}
		return {
			description,
			priority: card.priority ?? "",
			baseRef: card.baseRef ?? "",
			workflowId: card.workflowId ?? "",
			branchName: card.branchName ?? "",
			dependsOn: card.dependsOn ?? "",
			waitsFor: card.waitsFor ?? [],
		};
	}, [card]);

	// baseRef is required by the form schema but is not editable here; relax the
	// resolver so the (unchanged) base branch never blocks an edit submit.
	const methods = useForm<CreateTaskForm>({ values });
	const { control, handleSubmit, setValue } = methods;
	// dependsOn (stacking) and waitsFor (gate) are mutually exclusive — choose one via the toggle.
	const [relationMode, setRelationMode] = useState<"waitsFor" | "dependsOn">(card.dependsOn ? "dependsOn" : "waitsFor");
	const switchRelationMode = (mode: "waitsFor" | "dependsOn") => {
		setRelationMode(mode);
		if (mode === "waitsFor") setValue("dependsOn", "");
		else setValue("waitsFor", []);
	};

	const availableWorkflows = isStory ? workflows.filter((w) => w.forStory) : workflows.filter((w) => !w.forStory);

	const depsCardPool = Object.values(allCards).filter((c) => {
		if (c.id === card.id || c.columnId === "done") return false;
		if (isSubtask) return c.type !== "story";
		return true;
	});

	const submit = handleSubmit(async (data) => {
		setLoading(true);
		try {
			// Renumber to contiguous #1..#k and emit attachments in that order,
			// uploading any new files and keeping already-uploaded ones in place.
			const { text: description, order } = normalizeAttachmentTokens(data.description);
			const ordered = order
				.map((n) => attachments.find((a) => a.n === n))
				.filter((a): a is EditorAttachment => Boolean(a));
			const newFiles = ordered.filter((a) => a.file);
			const uploadedNew = newFiles.length
				? await uploadImages(
						workspaceId,
						card.id,
						newFiles.map((a) => ({ dataUrl: a.previewUrl, file: a.file as File })),
					)
				: [];
			let ui = 0;
			const descriptionAttachments = ordered
				.map((a) => a.uploaded ?? uploadedNew[ui++])
				.filter((x): x is NonNullable<typeof x> => x != null);
			const res = await updateCard({
				params: { id: card.id },
				body: {
					workspaceId,
					cardId: card.id,
					description,
					descriptionAttachments,
					priority: data.priority || undefined,
					dependsOn: isStory ? undefined : data.dependsOn || undefined,
					waitsFor: isStory || data.waitsFor.length === 0 ? undefined : data.waitsFor,
					workflowId: data.workflowId || undefined,
					branchName: canEditBranch ? data.branchName.trim() || undefined : undefined,
					revision: 0,
				},
			});
			if (res.error) {
				toast.error(`Failed to update ${isStory ? "story" : isSubtask ? "subtask" : "task"}`);
				return;
			}
			onClose();
			onRefresh();
		} finally {
			setLoading(false);
		}
	});

	const dialogTitle = isStory ? "Edit Story" : isSubtask ? "Edit Subtask" : "Edit Task";
	const description = useWatch({ control, name: "description" });

	return (
		<FormProvider {...methods}>
			<div className="fixed inset-0 z-50 flex items-center justify-center">
				<div className="absolute inset-0 bg-black/70" onClick={onClose} />
				<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
					{/* ── Left panel ── */}
					<div className="flex flex-col flex-1 overflow-hidden">
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">{dialogTitle}</span>
							<div className="flex-1" />
							<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
								<X size={18} />
							</button>
						</div>

						<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-2">
							<Controller
								name="description"
								render={({ field }) => (
									<DescriptionAttachmentEditor
										value={field.value ?? ""}
										onChange={(v) => {
											field.onChange(v);
											if (canEditBranch && !branchNameEdited) {
												setValue("branchName", deriveBranchName(v.split("\n")[0] ?? ""));
											}
										}}
										attachments={attachments}
										setAttachments={setAttachments}
										className="flex-1 min-h-0"
										placeholder="Describe what the agent should do..."
										autoFocus
									/>
								)}
							/>
						</div>
					</div>

					{/* ── Right sidebar ── */}
					<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
						<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
						</div>
						<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">
									{isStory ? "Orchestrator Workflow" : "Workflow"}
								</span>
								<RHFSelect name="workflowId" prefix={<WorkflowIcon size={14} className="text-[#8888a0]" />}>
									{availableWorkflows.map((w) => (
										<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
									))}
								</RHFSelect>
							</div>
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
								<PriorityField name="priority" />
							</div>
							{canEditBranch && (
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">Branch Name (optional)</span>
									<RHFInput
										name="branchName"
										onChange={() => setBranchNameEdited(true)}
										placeholder="auto-generated from description"
										prefix={<GitBranch size={13} className="text-[#4a4a5a]" />}
									/>
								</div>
							)}
							{!isStory && (
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">Relation</span>
									<div className="flex gap-1 rounded-md bg-[#1a1a1f] border border-[#2a2a35] p-0.5">
										<button
											type="button"
											onClick={() => switchRelationMode("waitsFor")}
											className={classNames(
												"flex-1 rounded py-1 text-[11px] transition-colors",
												relationMode === "waitsFor"
													? "bg-[#2a2a35] text-[#f0f0f5]"
													: "text-[#60607a] hover:text-[#f0f0f5]",
											)}
										>
											Waits for
										</button>
										<button
											type="button"
											onClick={() => switchRelationMode("dependsOn")}
											className={classNames(
												"flex-1 rounded py-1 text-[11px] transition-colors",
												relationMode === "dependsOn"
													? "bg-[#2a2a35] text-[#f0f0f5]"
													: "text-[#60607a] hover:text-[#f0f0f5]",
											)}
										>
											Depends on
										</button>
									</div>
									{relationMode === "waitsFor" ? (
										<>
											<span className="text-[10px] text-[#4a4a5a] -mt-1">
												Starts in a fresh branch once all of these are merged
											</span>
											<RHFSelect name="waitsFor" multiple placeholder="None" filterable clearable>
												{depsCardPool.map((c) => {
													const cDisplay = c.description?.split("\n")[0] ?? c.id;
													return (
														<SelectOption key={c.id} value={c.id} label={cDisplay} hideCheckIcon>
															<div className="flex items-center justify-between w-full gap-2 min-w-0">
																<span className="truncate text-sm">{cDisplay}</span>
																<span
																	className={classNames(
																		"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																		COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700",
																	)}
																>
																	{COLUMN_LABEL[c.columnId] ?? c.columnId}
																</span>
															</div>
														</SelectOption>
													);
												})}
											</RHFSelect>
										</>
									) : (
										<>
											<span className="text-[10px] text-[#4a4a5a] -mt-1">
												Continues in one ticket's branch once it reaches review
											</span>
											<RHFSelect name="dependsOn" placeholder="None" filterable clearable disabled={false}>
												{depsCardPool.map((c) => {
													const cDisplay = c.description?.split("\n")[0] ?? c.id;
													return (
														<SelectOption key={c.id} value={c.id} label={cDisplay} hideCheckIcon>
															<div className="flex items-center justify-between w-full gap-2 min-w-0">
																<span className="truncate text-sm">{cDisplay}</span>
																<span
																	className={classNames(
																		"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																		COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700",
																	)}
																>
																	{COLUMN_LABEL[c.columnId] ?? c.columnId}
																</span>
															</div>
														</SelectOption>
													);
												})}
											</RHFSelect>
										</>
									)}
								</div>
							)}
						</div>
						<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
							<div className="flex-1" />
							<button
								onClick={onClose}
								className="px-4 py-2 rounded-md text-xs font-medium text-[#8888a0] hover:text-[#f0f0f5] transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={submit}
								disabled={!description?.trim() || loading}
								className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white bg-[#7c6aff] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
							>
								{loading ? "Saving..." : "Save Changes"}
							</button>
						</div>
					</div>
				</div>
			</div>
		</FormProvider>
	);
}

// ── Add / edit a story subtask draft (in-memory; no API call) ───────────────

interface CreateSubtaskDialogProps {
	open: boolean;
	onClose: () => void;
	onSave: (subtask: SubtaskDraft) => void;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	draftSubtasks: SubtaskDraft[];
	editingSubtask?: SubtaskDraft;
	defaultBranch: string;
	branches: string[];
}

function CreateSubtaskDialog({
	open,
	onClose,
	onSave,
	allCards,
	workflows,
	draftSubtasks,
	editingSubtask,
	defaultBranch,
	branches,
}: CreateSubtaskDialogProps) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const defaultWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];

	const [attachments, setAttachments] = useState<EditorAttachment[]>([]);
	const [branchNameEdited, setBranchNameEdited] = useState(false);

	const values = useMemo<SubtaskDraftForm>(
		() => ({
			tempId: editingSubtask?.tempId ?? "",
			description: editingSubtask?.description ?? "",
			priority: editingSubtask?.priority ?? "",
			baseRef: editingSubtask?.baseRef || defaultBranch,
			workflowId: editingSubtask?.workflowId || (defaultWorkflow?.id ?? ""),
			branchName: editingSubtask?.branchName || "",
			dependsOn: editingSubtask?.dependsOn ?? "",
			waitsFor: editingSubtask?.waitsFor ?? [],
		}),
		[editingSubtask, defaultBranch, defaultWorkflow?.id],
	);

	const methods = useForm<SubtaskDraftForm>({ resolver: zodResolver(subtaskDraftSchema), values });
	const { control, handleSubmit, setValue, reset } = methods;

	// Sync the File-backed images + branch-edited flag whenever the dialog opens
	// or switches editing target (server/external draft data, not form values).
	useEffect(() => {
		if (!open) return;
		setAttachments(
			(editingSubtask?.pendingImages ?? []).map((p, i) => ({
				n: p.n ?? i + 1,
				name: p.file.name,
				previewUrl: p.dataUrl,
				file: p.file,
			})),
		);
		setBranchNameEdited(!!editingSubtask?.branchName);
		reset(values);
	}, [open, editingSubtask, reset, values]);

	const isEditing = !!editingSubtask;
	const otherDrafts = draftSubtasks.filter((s) => s.tempId !== editingSubtask?.tempId);
	const boardCardPool = Object.values(allCards).filter((c) => c.columnId !== "done" && c.type !== "story");
	const watchedDescription = useWatch({ control, name: "description" });

	const submit = handleSubmit((data) => {
		const { text: description, order } = normalizeAttachmentTokens(data.description);
		const orderedImages: PendingImage[] = order
			.map((n) => attachments.find((a) => a.n === n))
			.filter((a): a is EditorAttachment => Boolean(a?.file))
			.map((a) => ({ dataUrl: a.previewUrl, file: a.file as File, n: a.n }));
		onSave({
			...data,
			description,
			tempId: editingSubtask?.tempId ?? `draft-${Date.now()}-${Math.random()}`,
			pendingImages: orderedImages,
		});
	});

	if (!open) return null;

	return (
		<FormProvider {...methods}>
			<div className="fixed inset-0 z-[60] flex items-center justify-center">
				<div className="absolute inset-0 bg-black/50" onClick={onClose} />
				<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
					{/* ── Left panel ── */}
					<div className="flex flex-col flex-1 overflow-hidden">
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">
								{isEditing ? "Edit Subtask" : "New Subtask"}
							</span>
							<div className="flex-1" />
							<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
								<X size={18} />
							</button>
						</div>

						<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-2">
							<Controller
								name="description"
								render={({ field }) => (
									<DescriptionAttachmentEditor
										value={field.value ?? ""}
										onChange={(v) => {
											field.onChange(v);
											if (!branchNameEdited) setValue("branchName", deriveBranchName(v.split("\n")[0] ?? ""));
										}}
										attachments={attachments}
										setAttachments={setAttachments}
										className="flex-1 min-h-0"
										placeholder="Describe what the agent should do..."
										autoFocus
									/>
								)}
							/>
						</div>
					</div>

					{/* ── Right sidebar ── */}
					<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
						<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
						</div>

						<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Workflow</span>
								<RHFSelect name="workflowId" prefix={<WorkflowIcon size={14} className="text-[#8888a0]" />}>
									{taskWorkflows.map((w) => (
										<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
									))}
								</RHFSelect>
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
								<PriorityField name="priority" />
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Branch Name (optional)</span>
								<RHFInput
									name="branchName"
									onChange={() => setBranchNameEdited(true)}
									placeholder="auto-generated from description"
									prefix={<GitBranch size={13} className="text-[#4a4a5a]" />}
								/>
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Base Branch</span>
								<RHFSelect
									name="baseRef"
									placeholder="main"
									filterable
									prefix={<GitBranch size={13} className="text-[#8888a0]" />}
								>
									{branches.map((b) => (
										<SelectOption key={b} value={b} label={b} />
									))}
								</RHFSelect>
								<RHFError name="baseRef" className="text-[11px] text-[#ef4444]" />
							</div>

							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
								<RHFSelect name="dependsOn" placeholder="None" filterable clearable>
									{otherDrafts.map((draft) => {
										const draftDisplay = draft.description?.split("\n")[0] || draft.tempId;
										return (
											<SelectOption key={draft.tempId} value={draft.tempId} label={draftDisplay} hideCheckIcon>
												<div className="flex items-center justify-between w-full gap-2 min-w-0">
													<span className="truncate text-sm">{draftDisplay}</span>
													<span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium text-[#a78bfa] bg-[#a78bfa10]">
														this story
													</span>
												</div>
											</SelectOption>
										);
									})}
									{boardCardPool.map((c) => {
										const cDisplay = c.description?.split("\n")[0] ?? c.id;
										return (
											<SelectOption key={c.id} value={c.id} label={cDisplay} hideCheckIcon>
												<div className="flex items-center justify-between w-full gap-2 min-w-0">
													<span className="truncate text-sm">{cDisplay}</span>
													<span
														className={classNames(
															"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
															COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700",
														)}
													>
														{COLUMN_LABEL[c.columnId] ?? c.columnId}
													</span>
												</div>
											</SelectOption>
										);
									})}
								</RHFSelect>
							</div>
						</div>

						<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
							<div className="flex-1" />
							<button
								onClick={submit}
								disabled={!watchedDescription?.trim()}
								className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white bg-[#7c6aff] disabled:opacity-40 disabled:cursor-not-allowed"
							>
								<Plus size={14} />
								{isEditing ? "Save Changes" : "Add Subtask"}
							</button>
						</div>
					</div>
				</div>
			</div>
		</FormProvider>
	);
}
