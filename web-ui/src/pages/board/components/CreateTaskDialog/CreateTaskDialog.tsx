import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { CreateStoryForm, CreateTaskForm, SubtaskDraftForm } from "@runtime-validation/card";
import { createStoryFormSchema, createTaskFormSchema } from "@runtime-validation/card";
import { Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Controller, FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { TokenTextarea } from "@/components/TokenTextarea";
import { useRead } from "@/runtime/api-client";
import {
	applyTextareaEdit,
	atomicTokenEdit,
	normalizeAttachmentTokens,
	parseAttachmentTokenNumbers,
} from "@/utils/attachmentTokens";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";
import { CreateSubtaskDialog } from "./CreateSubtaskDialog";
import { CreateTaskConfigSidebar } from "./CreateTaskConfigSidebar";
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
	const descRef = useRef<HTMLTextAreaElement>(null);
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
			const { text: description, order } = normalizeAttachmentTokens(data.description);
			const orderedImages = order
				.map((n) => pendingImages.find((p) => p.n === n))
				.filter((p): p is PendingImage => Boolean(p));
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
			const orderedImages = order
				.map((n) => pendingImages.find((p) => p.n === n))
				.filter((p): p is PendingImage => Boolean(p));
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

	// Attachments shown/sent are derived from the `[Attachment #N]` tokens present
	// in the description (stable `n` per image), so any edit that drops a token
	// drops the image and native undo restores it. Token edits go through the
	// native pipeline (execCommand) to preserve the textarea's undo history.
	const setDescriptionFallback = (text: string) =>
		(activeMethods as unknown as UseFormReturn<FieldValues>).setValue("description", text, { shouldValidate: true });

	const byN = new Map(pendingImages.map((p) => [p.n, p]));
	const displayedImages = parseAttachmentTokenNumbers(activeDescription ?? "")
		.map((n) => byN.get(n))
		.filter((p): p is PendingImage => Boolean(p));

	const handleAddFiles = (files: FileList | File[]) => {
		const arr = Array.from(files);
		const ta = descRef.current;
		if (!arr.length || !ta) return;
		const pos = document.activeElement === ta ? ta.selectionStart : ta.value.length;
		const startN = pendingImages.reduce((max, p) => Math.max(max, p.n ?? 0), 0);
		const items: PendingImage[] = arr.map((file, i) => ({ n: startN + i + 1, file, dataUrl: null }));
		const before = ta.value.slice(0, pos);
		const lead = before && !/\s$/.test(before) ? " " : "";
		const insert = lead + items.map((it) => `[Attachment #${it.n}]`).join(" ");
		setPendingImages((prev) => [...prev, ...items]);
		if (!applyTextareaEdit(ta, pos, pos, insert))
			setDescriptionFallback(ta.value.slice(0, pos) + insert + ta.value.slice(pos));
		for (const it of items) {
			if (!it.file.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const url = ev.target?.result as string;
				setPendingImages((prev) => prev.map((p) => (p.n === it.n ? { ...p, dataUrl: url } : p)));
			};
			reader.readAsDataURL(it.file);
		}
	};

	const removeImage = (n: number) => {
		const ta = descRef.current;
		if (!ta) return;
		const m = ta.value.match(new RegExp(`\\[Attachment #${n}\\] ?`));
		if (m?.index == null) return;
		const start = m.index;
		const end = start + m[0].length;
		if (!applyTextareaEdit(ta, start, end, "")) setDescriptionFallback(ta.value.slice(0, start) + ta.value.slice(end));
	};

	// ImagePicker (chip ×) hands back the surviving list; drop the missing token.
	const handleImagesChange = (next: PendingImage[]) => {
		const removed = displayedImages.find((d) => !next.some((x) => x.n === d.n));
		if (removed?.n != null) removeImage(removed.n);
	};

	return (
		<>
			<FormProvider {...(activeMethods as unknown as UseFormReturn<FieldValues>)}>
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

								{/* Description */}
								<Controller
									name="description"
									render={({ field }) => (
										<TokenTextarea
											ref={descRef}
											value={field.value ?? ""}
											autoFocus
											onChange={(e) => {
												field.onChange(e.target.value);
												if (isTask && !branchNameEdited) {
													taskMethods.setValue(
														"branchName",
														deriveBranchName((e.target.value || "").split("\n")[0] ?? ""),
													);
												}
											}}
											onKeyDown={(e) => {
												const edit = atomicTokenEdit(e);
												if (!edit) return;
												if (!applyTextareaEdit(e.currentTarget, edit.start, edit.end, edit.insert)) {
													field.onChange(
														e.currentTarget.value.slice(0, edit.start) +
															edit.insert +
															e.currentTarget.value.slice(edit.end),
													);
												}
											}}
											onPaste={(e) => {
												if (e.clipboardData.files.length === 0) return;
												if (!Array.from(e.clipboardData.files).some((f) => f.type.startsWith("image/"))) return;
												e.preventDefault();
												handleAddFiles(e.clipboardData.files);
											}}
											placeholder="Describe what the agent should do..."
											className={classNames("shrink-0", isTask ? "flex-1 min-h-0" : "h-36")}
											metricsClassName="text-[15px] text-[#c0c0d0] leading-[1.7] placeholder-[#2a2a35] h-full p-0"
										/>
									)}
								/>

								<ImagePicker pending={displayedImages} onChange={handleImagesChange} />

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
