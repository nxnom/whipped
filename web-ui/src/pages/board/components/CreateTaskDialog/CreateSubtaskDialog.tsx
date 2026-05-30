import { RHFError, RHFInput, RHFSelect, RHFTextarea, SelectOption } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { SubtaskDraftForm } from "@runtime-validation/card";
import { subtaskDraftSchema } from "@runtime-validation/card";
import { GitBranch, Monitor, Paperclip, Plus, Workflow as WorkflowIcon, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";
import { COLUMN_BADGE, COLUMN_LABEL } from "./constants";
import { addFilesFromClipboard } from "./helpers";
import { ImagePicker } from "./ImagePicker";
import { PriorityField } from "./PriorityField";
import type { PendingImage, SubtaskDraft } from "./types";

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

export function CreateSubtaskDialog({
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
