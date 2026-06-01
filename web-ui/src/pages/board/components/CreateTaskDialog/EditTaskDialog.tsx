import { RHFInput, RHFSelect, RHFTextarea, SelectOption, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import type { CreateTaskForm } from "@runtime-validation/card";
import { GitBranch, Paperclip, Workflow as WorkflowIcon, X } from "lucide-react";
import { useMemo, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useWrite } from "@/runtime/api-client";
import { deriveBranchName } from "@/utils/branch";
import { classNames } from "@/utils/classNames";
import { COLUMN_BADGE, COLUMN_LABEL } from "./constants";
import { addFilesFromClipboard, uploadImages } from "./helpers";
import { ImagePicker } from "./ImagePicker";
import { PriorityField } from "./PriorityField";
import type { PendingImage } from "./types";

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
			dependsOn: card.dependsOn ?? "",
			waitsFor: card.waitsFor ?? [],
		}),
		[card],
	);

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
			const newUploads = pendingImages.length > 0 ? await uploadImages(workspaceId, card.id, pendingImages) : [];
			const res = await updateCard({
				params: { id: card.id },
				body: {
					workspaceId,
					cardId: card.id,
					description: data.description,
					descriptionAttachments: [...existingAttachments, ...newUploads],
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

						<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-2">
							<RHFTextarea
								name="description"
								autoFocus
								onChange={(v) => {
									if (canEditBranch && !branchNameEdited) {
										setValue("branchName", deriveBranchName((v ?? "").split("\n")[0] ?? ""));
									}
								}}
								placeholder="Describe what the agent should do..."
								className="flex-1 min-h-0 border-transparent! bg-transparent! text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7]"
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
