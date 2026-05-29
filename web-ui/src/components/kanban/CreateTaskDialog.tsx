import { RHFError, RHFInput, RHFSelect, RHFTextarea, SelectOption, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { CreateStoryForm, CreateTaskForm, SubtaskDraftForm } from "@runtime-validation/card";
import { createStoryFormSchema, createTaskFormSchema, subtaskDraftSchema } from "@runtime-validation/card";
import {
	GitBranch,
	GripVertical,
	ListTree,
	Monitor,
	Paperclip,
	Plus,
	Sparkles,
	Workflow as WorkflowIcon,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";
import { Controller, FormProvider, useFieldArray, useForm, useFormContext, useWatch } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";

interface PendingImage {
	dataUrl: string | null;
	file: File;
}

// A subtask draft as held in component state: the RHF-validated fields plus the
// File-backed pending images (which live outside zod validation).
export interface SubtaskDraft extends SubtaskDraftForm {
	pendingImages: PendingImage[];
}

async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
	const { uploadAttachmentFile } = await import("@/runtime/attachments");
	const results = [];
	for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
	return results;
}

function addFilesFromClipboard(
	e: { clipboardData: DataTransfer; preventDefault(): void },
	setter: (fn: (prev: PendingImage[]) => PendingImage[]) => void,
) {
	const files = Array.from(e.clipboardData.files);
	if (!files.length) return;
	e.preventDefault();
	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const r = new FileReader();
			r.onload = (ev) => setter((p) => [...p, { dataUrl: ev.target?.result as string, file }]);
			r.readAsDataURL(file);
		} else {
			setter((p) => [...p, { dataUrl: null, file }]);
		}
	}
}

function ImagePicker({ pending, onChange }: { pending: PendingImage[]; onChange: (imgs: PendingImage[]) => void }) {
	const ref = useRef<HTMLInputElement>(null);
	const addFiles = (files: FileList | File[]) => {
		Array.from(files).forEach((file) => {
			if (file.type.startsWith("image/")) {
				const r = new FileReader();
				r.onload = (ev) => onChange([...pending, { dataUrl: ev.target?.result as string, file }]);
				r.readAsDataURL(file);
			} else {
				onChange([...pending, { dataUrl: null, file }]);
			}
		});
	};
	if (pending.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 mt-2 shrink-0">
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
			{pending.map((img, i) => (
				<div key={i} className="relative group">
					{img.dataUrl ? (
						<img
							src={img.dataUrl}
							alt={img.file.name}
							className="h-12 w-12 object-cover rounded border border-[#2a2a35]"
						/>
					) : (
						<div className="h-12 w-12 flex flex-col items-center justify-center rounded border border-[#2a2a35] bg-[#1a1a1f] gap-1">
							<Paperclip size={12} className="text-[#60607a]" />
							<span className="text-[9px] text-[#60607a] truncate w-10 text-center px-1">{img.file.name}</span>
						</div>
					)}
					<button
						type="button"
						onClick={() => onChange(pending.filter((_, j) => j !== i))}
						className="absolute -top-1 -right-1 size-4 rounded-full bg-[#1a1a1f] border border-[#2a2a35] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<X size={9} className="text-[#f0f0f5]" />
					</button>
				</div>
			))}
		</div>
	);
}

const PRIORITY_OPTIONS = [
	{ value: "urgent", label: "Urgent", dot: "#ef4444", bg: "#ef444415", text: "#ef4444", border: "#ef444440" },
	{ value: "high", label: "High", dot: "#f97316", bg: "#f9731615", text: "#f97316", border: "#f9731640" },
	{ value: "medium", label: "Medium", dot: "#eab308", bg: "#eab30815", text: "#eab308", border: "#eab30840" },
	{ value: "low", label: "Low", dot: "#94a3b8", bg: "#94a3b820", text: "#94a3b8", border: "#94a3b850" },
] as const;

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

type Mode = "task" | "story";

// ─── Priority pills (RHF-controlled) ─────────────────────────────────────────

function PriorityField({ name }: { name: string }) {
	const { control } = useFormContext();
	return (
		<Controller
			control={control}
			name={name}
			render={({ field }) => (
				<div className="flex flex-wrap gap-1.5">
					{PRIORITY_OPTIONS.map((opt) => {
						const active = field.value === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => field.onChange(active ? "" : opt.value)}
								className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition-colors"
								style={
									active
										? { background: opt.bg, color: opt.text, borderColor: opt.border, fontWeight: 500 }
										: { background: "#1a1a1f", color: "#60607a", borderColor: "#2a2a35" }
								}
							>
								<span className="size-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />
								{opt.label}
							</button>
						);
					})}
				</div>
			)}
		/>
	);
}

// ─── Subtask creation dialog ─────────────────────────────────────────────────

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

	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [branchNameEdited, setBranchNameEdited] = useState(false);

	const values = useMemo<SubtaskDraftForm>(
		() => ({
			tempId: editingSubtask?.tempId ?? "",
			description: editingSubtask?.description ?? "",
			priority: editingSubtask?.priority ?? "",
			baseRef: editingSubtask?.baseRef || defaultBranch,
			workflowId: editingSubtask?.workflowId || (defaultWorkflow?.id ?? ""),
			branchName: editingSubtask?.branchName || "",
			dependsOn: editingSubtask?.dependsOn ?? [],
		}),
		[editingSubtask, defaultBranch, defaultWorkflow?.id],
	);

	const methods = useForm<SubtaskDraftForm>({ resolver: zodResolver(subtaskDraftSchema), values });
	const { control, handleSubmit, setValue, reset } = methods;

	// Sync the File-backed images + branch-edited flag whenever the dialog opens
	// or switches editing target (server/external draft data, not form values).
	useEffect(() => {
		if (!open) return;
		setPendingImages(editingSubtask?.pendingImages ?? []);
		setBranchNameEdited(!!editingSubtask?.branchName);
		reset(values);
	}, [open, editingSubtask, reset, values]);

	const isEditing = !!editingSubtask;
	const otherDrafts = draftSubtasks.filter((s) => s.tempId !== editingSubtask?.tempId);
	const boardCardPool = Object.values(allCards).filter((c) => c.columnId !== "done" && c.type !== "story");
	const watchedDescription = useWatch({ control, name: "description" });

	const submit = handleSubmit((data) => {
		onSave({
			...data,
			tempId: editingSubtask?.tempId ?? `draft-${Date.now()}-${Math.random()}`,
			pendingImages,
		});
	});

	if (!open) return null;

	return (
		<FormProvider {...methods}>
			<div className="fixed inset-0 z-[60] flex items-center justify-center">
				<div className="absolute inset-0 bg-black/50" onClick={onClose} />
				<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
					{/* ── Left panel ── */}
					<div
						className="flex flex-col flex-1 overflow-hidden"
						onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}
					>
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">
								{isEditing ? "Edit Subtask" : "New Subtask"}
							</span>
							<div className="flex-1" />
							<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
								<X size={18} />
							</button>
						</div>

						<div
							className="flex flex-col flex-1 min-h-0 px-8 py-4 gap-2"
							onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}
						>
							<RHFTextarea
								name="description"
								autoFocus
								onChange={(v) => {
									if (!branchNameEdited) setValue("branchName", deriveBranchName((v ?? "").split("\n")[0] ?? ""));
								}}
								placeholder="Describe what the agent should do..."
								className="flex-1 min-h-0 bg-transparent text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7]"
							/>
							<ImagePicker pending={pendingImages} onChange={setPendingImages} />
							<div className="flex items-center gap-2 shrink-0 mt-auto pt-1">
								<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
									<Paperclip size={12} />
									Attach files
								</button>
								<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
									<Monitor size={12} />
									Screenshot
								</button>
							</div>
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
								<RHFSelect name="dependsOn" multiple placeholder="None" filterable clearable>
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

// ─── Edit dialog ─────────────────────────────────────────────────────────────

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

	const [existingAttachments, setExistingAttachments] = useState(card.descriptionAttachments ?? []);
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [branchNameEdited, setBranchNameEdited] = useState(!!card.branchName);
	const [loading, setLoading] = useState(false);

	const { trigger: updateCard } = useWrite((api) => api("cards/:id").PATCH());

	const values = useMemo<CreateTaskForm>(
		() => ({
			description: card.description ?? "",
			priority: card.priority ?? "",
			baseRef: card.baseRef ?? "",
			workflowId: card.workflowId ?? "",
			branchName: card.branchName ?? "",
			dependsOn: card.dependsOn ?? [],
		}),
		[card],
	);

	// baseRef is required by the form schema but is not editable here; relax the
	// resolver so the (unchanged) base branch never blocks an edit submit.
	const methods = useForm<CreateTaskForm>({ values });
	const { control, handleSubmit, setValue } = methods;

	const availableWorkflows = isStory ? workflows.filter((w) => w.forStory) : workflows.filter((w) => !w.forStory);

	const depsCardPool = Object.values(allCards).filter((c) => {
		if (c.id === card.id || c.columnId === "done") return false;
		if (isSubtask) return c.type !== "story";
		return true;
	});

	const submit = handleSubmit(async (data) => {
		setLoading(true);
		try {
			const newUploads = pendingImages.length > 0 ? await uploadImages(workspaceId, card.id, pendingImages) : [];
			const res = await updateCard({
				params: { id: card.id },
				body: {
					workspaceId,
					cardId: card.id,
					description: data.description,
					descriptionAttachments: [...existingAttachments, ...newUploads],
					priority: data.priority || undefined,
					dependsOn: isStory ? undefined : data.dependsOn,
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
					<div
						className="flex flex-col flex-1 overflow-hidden"
						onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}
					>
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">{dialogTitle}</span>
							<div className="flex-1" />
							<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
								<X size={18} />
							</button>
						</div>

						<div className="flex flex-col flex-1 min-h-0 px-8 py-4 gap-2">
							<RHFTextarea
								name="description"
								autoFocus
								onChange={(v) => {
									if (canEditBranch && !branchNameEdited) {
										setValue("branchName", deriveBranchName((v ?? "").split("\n")[0] ?? ""));
									}
								}}
								placeholder="Describe what the agent should do..."
								className="flex-1 min-h-0 bg-transparent text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7]"
							/>
							{existingAttachments.length > 0 && (
								<div className="flex flex-wrap gap-1.5 shrink-0">
									{existingAttachments.map((att, i) => (
										<span
											key={i}
											className="inline-flex items-center gap-1 text-[11px] text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35] rounded px-1.5 py-0.5"
										>
											<Paperclip size={10} className="shrink-0" /> {att.name}
											<button
												type="button"
												onClick={() => setExistingAttachments((a) => a.filter((_, j) => j !== i))}
												className="text-[#4a4a5a] hover:text-[#ef4444] transition-colors"
											>
												<X size={9} />
											</button>
										</span>
									))}
								</div>
							)}
							<ImagePicker pending={pendingImages} onChange={setPendingImages} />
							<div className="flex items-center gap-2 shrink-0 mt-auto pt-1">
								<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
									<Paperclip size={12} />
									Attach files
								</button>
							</div>
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
									<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
									<RHFSelect name="dependsOn" multiple placeholder="None" filterable clearable>
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

// ─── Main dialog ──────────────────────────────────────────────────────────────

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

	const { trigger: createCard } = useWrite((api) => api("cards").POST());
	const { trigger: updateCard } = useWrite((api) => api("cards/:id").PATCH());

	const taskValues = useMemo<CreateTaskForm>(
		() => ({
			description: "",
			priority: "",
			baseRef: defaultBranch,
			workflowId: defaultTaskWorkflow?.id ?? "",
			branchName: "",
			dependsOn: [],
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
			// Inherit shared worktree from the single dep if present
			let sharedWorktreeId: string | undefined;
			if (data.dependsOn.length === 1) {
				const dep = allCards[data.dependsOn[0]!];
				if (dep) sharedWorktreeId = dep.sharedWorktreeId ?? dep.id;
			}
			const res = await createCard({
				body: {
					workspaceId,
					description: data.description.trim(),
					priority: data.priority || undefined,
					readyForDev: readyForDev || undefined,
					dependsOn: data.dependsOn.length > 0 ? data.dependsOn : undefined,
					baseRef: data.baseRef || undefined,
					workflowId: data.workflowId || undefined,
					branchName: data.branchName.trim() || undefined,
					sharedWorktreeId,
				},
			});
			if (res.error || !res.data) {
				toast.error("Failed to create task");
				return;
			}
			const card = res.data;
			if (pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, card.id, pendingImages);
				await updateCard({
					params: { id: card.id },
					body: { workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 },
				});
			}
			handleClose();
			onRefresh();
		} catch {
			toast.error("Failed to create task");
		} finally {
			setLoading(false);
		}
	});

	const handleCreateStory = storyMethods.handleSubmit(async (data) => {
		setLoading(true);
		const drafts = data.subtasks.map((s) => ({ ...s, pendingImages: subtaskImages[s.tempId] ?? [] }));
		console.log("[CreateStory] Starting story creation");
		console.log("[CreateStory] Story description:", data.description);
		console.log("[CreateStory] Story priority:", data.priority);
		console.log("[CreateStory] Base ref:", data.baseRef);
		console.log("[CreateStory] Story workflow ID:", data.workflowId);
		console.log("[CreateStory] Ready for dev:", readyForDev);
		console.log("[CreateStory] Subtasks:", JSON.parse(JSON.stringify(drafts)));
		try {
			const tempIdToRealId = new Map<string, string>();
			const created: Array<{ realId: string; rawDeps: string[] }> = [];
			for (const subtask of drafts) {
				const existingDeps = subtask.dependsOn.filter((dep) => !drafts.some((s) => s.tempId === dep));
				const subtaskDisplay = subtask.description?.split("\n")[0] || subtask.tempId;
				console.log(`[CreateStory] Creating subtask "${subtaskDisplay}"`, {
					workflowId: subtask.workflowId,
					baseRef: subtask.baseRef || data.baseRef,
					branchName: subtask.branchName,
					priority: subtask.priority,
					existingDeps,
				});
				const res = await createCard({
					body: {
						workspaceId,
						description: subtask.description.trim(),
						type: "subtask",
						priority: subtask.priority || undefined,
						baseRef: subtask.baseRef || data.baseRef || undefined,
						workflowId: subtask.workflowId || undefined,
						branchName: subtask.branchName.trim() || undefined,
						dependsOn: existingDeps.length > 0 ? existingDeps : undefined,
						readyForDev: readyForDev,
					},
				});
				if (res.error || !res.data) {
					toast.error("Failed to create story");
					return;
				}
				const card = res.data;
				if (subtask.pendingImages.length > 0) {
					const uploaded = await uploadImages(workspaceId, card.id, subtask.pendingImages);
					await updateCard({
						params: { id: card.id },
						body: { workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 },
					});
				}
				console.log(`[CreateStory] Subtask "${subtaskDisplay}" created with id: ${card.id}`);
				tempIdToRealId.set(subtask.tempId, card.id);
				created.push({ realId: card.id, rawDeps: subtask.dependsOn });
			}
			for (const { realId, rawDeps } of created) {
				const batchDeps = rawDeps.filter((dep) => tempIdToRealId.has(dep));
				if (batchDeps.length === 0) continue;
				const resolvedBatchDeps = batchDeps.map((dep) => tempIdToRealId.get(dep)!);
				const existingDeps = rawDeps.filter((dep) => !tempIdToRealId.has(dep));
				await updateCard({
					params: { id: realId },
					body: { workspaceId, cardId: realId, dependsOn: [...existingDeps, ...resolvedBatchDeps], revision: 0 },
				});
			}
			console.log("[CreateStory] All subtasks created. tempId→realId map:", Object.fromEntries(tempIdToRealId));
			console.log(
				"[CreateStory] Creating story card with subtask deps:",
				created.map((c) => c.realId),
			);
			const storyRes = await createCard({
				body: {
					workspaceId,
					description: data.description.trim(),
					type: "story",
					priority: data.priority || undefined,
					baseRef: data.baseRef || undefined,
					workflowId: data.workflowId || undefined,
					dependsOn: created.map((c) => c.realId),
				},
			});
			if (storyRes.error || !storyRes.data) {
				toast.error("Failed to create story");
				return;
			}
			const storyCard = storyRes.data;
			if (pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, storyCard.id, pendingImages);
				await updateCard({
					params: { id: storyCard.id },
					body: { workspaceId, cardId: storyCard.id, descriptionAttachments: uploaded, revision: 0 },
				});
			}
			// Pass 3: wire sharedWorktreeId on all subtasks so they share the story's worktree
			for (const { realId } of created) {
				await updateCard({
					params: { id: realId },
					body: { workspaceId, cardId: realId, sharedWorktreeId: storyCard.id, revision: 0 },
				});
			}
			console.log("[CreateStory] Story card created with id:", storyCard.id);
			handleClose();
			onRefresh();
		} catch (err) {
			console.error("[CreateStory] Error:", err);
			toast.error("Failed to create story");
		} finally {
			setLoading(false);
		}
	});

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
										"bg-transparent text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7] shrink-0",
										isTask ? "flex-1 min-h-0" : "h-36",
									)}
								/>

								<ImagePicker pending={pendingImages} onChange={setPendingImages} />

								{/* Story: subtasks */}
								{!isTask && (
									<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
										<div className="h-px bg-[#2a2a35] shrink-0 my-2" />
										{/* Subtasks header */}
										<div className="flex items-center gap-2 shrink-0 mb-2">
											<ListTree size={14} className="text-[#8888a0]" />
											<span className="text-xs font-semibold text-[#8888a0]">Subtasks</span>
											{subtaskDrafts.length > 0 && (
												<div className="bg-[#2a2a35] rounded-full px-1.5 py-0.5">
													<span className="text-[10px] text-[#60607a]">{subtaskDrafts.length}</span>
												</div>
											)}
											<div className="flex-1" />
											<button className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#7c6aff15] border border-[#7c6aff30] text-[11px] font-medium text-[#7c6aff]">
												<Sparkles size={12} />
												Generate
											</button>
											<button
												onClick={() => {
													setEditingTempId(null);
													setSubtaskDialogOpen(true);
												}}
												className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors"
											>
												<Plus size={12} />
												Add
											</button>
										</div>
										{/* Subtask list */}
										<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
											{subtaskDrafts.length === 0 && (
												<div
													onClick={() => {
														setEditingTempId(null);
														setSubtaskDialogOpen(true);
													}}
													className="border border-dashed border-[#2a2a35] rounded-lg p-5 flex flex-col items-center gap-2 cursor-pointer hover:border-[#3a3a48] hover:bg-white/[0.02] transition-colors"
												>
													<Plus size={16} className="text-[#4a4a5a]" />
													<p className="text-xs text-[#4a4a5a]">At least one subtask is required</p>
												</div>
											)}
											{subtaskDrafts.map((subtask, i) => {
												const depLabels = subtask.dependsOn.map((dep) => {
													const draft = subtaskDrafts.find((s) => s.tempId === dep);
													return draft
														? `#${subtaskDrafts.indexOf(draft) + 1}`
														: (allCards[dep]?.description?.split("\n")[0] ?? dep);
												});
												const priorityOpt = PRIORITY_OPTIONS.find((p) => p.value === subtask.priority);
												return (
													<button
														key={subtask.tempId}
														onClick={() => {
															setEditingTempId(subtask.tempId);
															setSubtaskDialogOpen(true);
														}}
														className="flex items-center gap-2.5 bg-[#1a1a1f] border border-[#2a2a35] rounded-md px-2.5 py-2 text-left hover:border-[#3a3a48] transition-colors group w-full"
													>
														<GripVertical size={12} className="text-[#2a2a35] shrink-0" />
														<span className="text-[10px] text-[#4a4a5a] font-mono shrink-0 w-4">{i + 1}</span>
														<span className="flex-1 min-w-0 text-xs text-[#f0f0f5] truncate">
															{subtask.description?.split("\n")[0] ?? subtask.tempId}
														</span>
														{priorityOpt && (
															<span
																className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
																style={{ color: priorityOpt.text, background: priorityOpt.bg }}
															>
																{priorityOpt.label}
															</span>
														)}
														{depLabels.length > 0 && (
															<span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full text-[#3b82f6] bg-[#3b82f610] border border-[#3b82f620]">
																after {depLabels.join(" ")}
															</span>
														)}
														<span
															onClick={(e) => {
																e.stopPropagation();
																removeSubtask(subtask.tempId);
															}}
															className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#4a4a5a] hover:text-[#ef4444] p-0.5"
														>
															<X size={12} />
														</span>
													</button>
												);
											})}
										</div>
									</div>
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
						<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
							{/* Config header */}
							<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
								<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
							</div>

							{/* Config fields */}
							<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
								{/* Workflow */}
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">
										{isTask ? "Workflow" : "Orchestrator Workflow"}
									</span>
									{activeWorkflows.length === 0 ? (
										<button
											className="text-[11px] text-amber-500 hover:text-amber-400 underline text-left transition-colors"
											onClick={() => {
												handleClose();
												navigate(`/${encodeURIComponent(workspaceId)}/settings/workflows`);
											}}
										>
											No workflows — create one in Settings
										</button>
									) : (
										<RHFSelect
											name="workflowId"
											prefix={<WorkflowIcon size={14} style={{ color: isTask ? "#8888a0" : "#a78bfa" }} />}
										>
											{activeWorkflows.map((w) => (
												<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
											))}
										</RHFSelect>
									)}
								</div>

								{/* Priority */}
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
									<PriorityField name="priority" />
								</div>

								{/* Branch Name (task only) */}
								{isTask && (
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

								{/* Base Branch */}
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
								</div>

								{/* Dependencies (task only) */}
								{isTask && (
									<div className="flex flex-col gap-2">
										<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
										<RHFSelect name="dependsOn" multiple placeholder="None" filterable clearable>
											{Object.values(allCards)
												.filter((c) => c.columnId !== "done")
												.map((c) => {
													const cDisplay = c.description?.split("\n")[0] ?? c.id;
													return (
														<SelectOption
															key={c.id}
															value={c.id}
															label={cDisplay}
															hideCheckIcon
															className={({ selected }) => (selected ? "bg-gray-700" : "")}
														>
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
								)}
							</div>

							{/* Footer */}
							<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
								<button onClick={() => setReadyForDev(!readyForDev)} className="flex items-center gap-1.5">
									<div
										className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
										style={{ background: readyForDev ? accentColor : "#2a2a35" }}
									>
										<div
											className="absolute top-0.5 size-3.5 rounded-full bg-white transition-transform"
											style={{ transform: `translateX(${readyForDev ? 14 : 2}px)` }}
										/>
									</div>
									<span className="text-[11px] text-[#8888a0]">Auto-start</span>
								</button>
								<div className="flex-1" />
								<button
									onClick={isTask ? handleCreateTask : handleCreateStory}
									disabled={
										loading ||
										!activeDescription?.trim() ||
										(!isTask && subtaskDrafts.length === 0) ||
										activeWorkflows.length === 0
									}
									className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
									style={{ background: accentColor }}
								>
									<Plus size={14} />
									{loading ? "Creating..." : isTask ? "Create Task" : "Create Story"}
								</button>
							</div>
						</div>
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
