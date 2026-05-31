import { zodResolver } from "@hookform/resolvers/zod";
import { EMPTY_INLINE_PROMPT, type PromptValue, type RuntimeAgentId, type Workflow } from "@runtime-contract";
import { type WorkflowForm, type WorkflowSlotForm, workflowFormSchema } from "@runtime-validation/workflow";
import { Star, Workflow as WorkflowIcon, X } from "lucide-react";
import { useState } from "react";
import { Controller, FormProvider, useFieldArray, useForm } from "react-hook-form";
import { FilePickerDialog } from "@/components/FilePickerDialog";
import { defaultPromptPath, showPromptLinkDialog } from "../PromptLinkDialog";
import { slotDefaults } from "./constants";
import { promptInlineText } from "./helpers";
import { SlotConfigPanel } from "./SlotConfigPanel";
import { SlotInstructionsEditor } from "./SlotInstructionsEditor";
import { SlotPipeline } from "./SlotPipeline";
import { usePromptFile } from "./usePromptFile";

export function WorkflowEditorDialog({
	workflow,
	defaultBinary,
	workspaceId,
	repoPath,
	isNew = false,
	onUpdate,
	onSave,
	onClose,
}: {
	workflow: Workflow;
	defaultBinary: RuntimeAgentId;
	workspaceId: string;
	repoPath: string;
	isNew?: boolean;
	onUpdate: (wf: Workflow) => void;
	onSave: (wf: Workflow) => void;
	onClose: () => void;
}) {
	// Initial values come straight from the incoming workflow. `values` keeps the
	// form in sync without a useEffect; we never reset on every render because the
	// dialog mounts per-workflow (key'd by openWorkflowId in the parent).
	const methods = useForm<WorkflowForm, unknown, WorkflowForm>({
		resolver: zodResolver(workflowFormSchema),
		values: workflow as WorkflowForm,
	});
	const { control, watch, setValue, getValues, handleSubmit } = methods;
	const { append, replace } = useFieldArray({ control, name: "slots", keyName: "_key" });

	const watchedSlots = watch("slots");
	const isDefault = watch("isDefault");
	const forStory = watch("forStory");

	const sortedSlots = [...watchedSlots].sort((a, b) => a.order - b.order);
	const [selectedSlotId, setSelectedSlotId] = useState<string>(sortedSlots[0]?.id ?? "");

	const selectedIndex = watchedSlots.findIndex((s) => s.id === selectedSlotId);
	const selectedSlot = selectedIndex >= 0 ? watchedSlots[selectedIndex] : undefined;

	const slotKey = `${selectedSlotId}::${selectedSlot?.prompt?.source ?? ""}::${
		selectedSlot?.prompt?.source === "file" ? selectedSlot.prompt.path : ""
	}`;

	// File-linked prompt state. The slot only stores {source: "file", path};
	// the file content lives in the hook and auto-saves back on edit.
	const {
		linkedContent,
		setLinkedContent,
		pathDraft,
		setPathDraft,
		saveStatus,
		setSaveStatus,
		browsingPath,
		setBrowsingPath,
		flushSave,
		scheduleSave,
	} = usePromptFile({ workspaceId, selectedSlot, slotKey });

	const switchSlot = (newSlotId: string) => {
		flushSave();
		setSelectedSlotId(newSlotId);
	};

	// Patch fields of the currently-selected slot in the RHF field array.
	const updateSlot = (patch: Partial<WorkflowSlotForm>) => {
		const idx = getValues("slots").findIndex((s) => s.id === selectedSlotId);
		if (idx < 0) return;
		for (const [k, v] of Object.entries(patch)) {
			setValue(`slots.${idx}.${k}` as `slots.${number}.${keyof WorkflowSlotForm}`, v as never, {
				shouldDirty: true,
			});
		}
	};

	// Persist a slot's prompt change (link / unlink / path swap) to the backend
	// immediately, independent of the dialog Save button. The file itself is
	// already written by the link flow / auto-save; this keeps the workflow's
	// prompt linkage in sync so closing without Save can't orphan it.
	const updateSlotPrompt = (prompt: PromptValue) => {
		updateSlot({ prompt });
		onUpdate(getValues() as Workflow);
	};

	const handleEditorChange = (text: string) => {
		if (!selectedSlot) return;
		if (selectedSlot.prompt.source === "file") {
			setLinkedContent(text);
			if (selectedSlot.prompt.path) scheduleSave(selectedSlot.prompt.path, text);
		} else {
			updateSlot({ prompt: { source: "inline", text } });
		}
	};

	const applyLinked = (path: string, content: string) => {
		updateSlotPrompt({ source: "file", path });
		setLinkedContent(content);
		setPathDraft(path);
		setSaveStatus("saved");
	};

	const handleLinkToFile = () => {
		if (!selectedSlot) return;
		showPromptLinkDialog({
			workspaceId,
			defaultPath: defaultPromptPath(repoPath, getValues("name"), selectedSlot.name),
			currentInline: promptInlineText(selectedSlot.prompt),
			onLinked: applyLinked,
		});
	};

	const handleDisconnect = () => {
		if (!selectedSlot) return;
		flushSave();
		// Preserve whatever was in the editor as the new inline content so no edit is lost.
		updateSlotPrompt({ source: "inline", text: linkedContent });
	};

	const commitPathChange = () => {
		if (!selectedSlot || selectedSlot.prompt.source !== "file") return;
		if (pathDraft === selectedSlot.prompt.path) return;
		flushSave();
		updateSlotPrompt({ source: "file", path: pathDraft });
	};

	const editorText = selectedSlot?.prompt.source === "file" ? linkedContent : promptInlineText(selectedSlot?.prompt);
	const editorReady = selectedSlot?.prompt.source !== "file" || saveStatus !== "loading";

	const onSubmit = (data: WorkflowForm) => {
		flushSave();
		onSave(data as Workflow);
		onClose();
	};
	const handleSave = handleSubmit(onSubmit);

	const handleDeleteSlot = () => {
		const remaining = getValues("slots").filter((s) => s.id !== selectedSlotId);
		const devs = remaining.filter((s) => s.type === "dev");
		const others = remaining.filter((s) => s.type !== "dev").map((s, i) => ({ ...s, order: i + 1 }));
		const updated = [...devs, ...others];
		replace(updated);
		setSelectedSlotId(updated[0]?.id ?? "");
	};

	const hasCR = watchedSlots.some((s) => s.type === "code_review");
	const hasQA = watchedSlots.some((s) => s.type === "qa");

	const addSlot = (type: "code_review" | "qa" | "custom" | "orch") => {
		const maxOrder = getValues("slots").reduce((m, s) => Math.max(m, s.order), 0);
		const d = slotDefaults(type);
		const newSlot: WorkflowSlotForm = {
			id: d.id,
			name: d.name,
			type,
			agentBinary: defaultBinary,
			order: maxOrder + 1,
			enabled: d.enabled,
			prompt: EMPTY_INLINE_PROMPT,
			effort: null,
			model: null,
		};
		append(newSlot);
		setSelectedSlotId(newSlot.id);
	};

	const nameEditable = selectedSlot?.type === "custom" || selectedSlot?.type === "orch";

	return (
		<FormProvider {...methods}>
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
				<div
					className="flex overflow-hidden bg-[#141418] rounded-xl border border-[#2a2a35] w-[87.5vw] max-w-[1400px] h-[89.5vh] max-h-[850px] shadow-[0_8px_40px_4px_rgba(0,0,0,0.38)]"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Left panel */}
					<div className="flex-1 flex flex-col overflow-hidden">
						{/* Dialog header */}
						<div className="flex items-center gap-3 shrink-0 px-6 py-4 border-b border-[#2a2a35]">
							<WorkflowIcon size={18} className="text-[#7c6aff] shrink-0" />
							<Controller
								control={control}
								name="name"
								render={({ field }) => (
									<input
										value={field.value}
										onChange={(e) => field.onChange(e.target.value)}
										className="bg-transparent outline-none text-[17px] font-semibold min-w-0 flex-1 text-[#f0f0f5]"
										placeholder="Workflow name"
									/>
								)}
							/>
							{isDefault && (
								<div className="flex items-center gap-1 shrink-0 bg-[#eab30815] rounded-[4px] px-2 py-[2px]">
									<Star size={10} className="text-[#eab308]" />
									<span className="text-[10px] font-medium text-[#eab308]">Default</span>
								</div>
							)}
							<div className="flex shrink-0 bg-[#3b82f615] rounded-[4px] px-2 py-[2px]">
								<span className="text-[10px] font-medium text-[#3b82f6]">{forStory ? "Story" : "Task"}</span>
							</div>
							<button onClick={onClose} className="hover:opacity-70 transition-opacity shrink-0">
								<X size={18} className="text-[#60607a]" />
							</button>
						</div>

						{/* Pipeline section */}
						<SlotPipeline
							sortedSlots={sortedSlots}
							selectedSlotId={selectedSlotId}
							forStory={forStory}
							hasCR={hasCR}
							hasQA={hasQA}
							onSwitchSlot={switchSlot}
							onAddSlot={addSlot}
						/>

						{/* Slot instructions editor */}
						{selectedSlot ? (
							<SlotInstructionsEditor
								selectedSlot={selectedSlot}
								saveStatus={saveStatus}
								pathDraft={pathDraft}
								setPathDraft={setPathDraft}
								editorText={editorText}
								editorReady={editorReady}
								onEditorChange={handleEditorChange}
								onLinkToFile={handleLinkToFile}
								onCommitPathChange={commitPathChange}
								onDisconnect={handleDisconnect}
								onBrowse={() => setBrowsingPath(true)}
							/>
						) : (
							<div className="flex-1 flex items-center justify-center text-[13px] text-[#4a4a5a]">
								Select a slot to edit its instructions
							</div>
						)}
					</div>

					{/* Right panel */}
					<SlotConfigPanel
						selectedSlot={selectedSlot}
						selectedIndex={selectedIndex}
						nameEditable={nameEditable}
						isNew={isNew}
						updateSlot={updateSlot}
						onDeleteSlot={handleDeleteSlot}
						onSave={handleSave}
					/>
				</div>
			</div>

			{/* Path-bar "Browse" file picker (re-link an already file-linked slot) */}
			{browsingPath && selectedSlot?.prompt.source === "file" && (
				<FilePickerDialog
					initialPath={pathDraft.replace(/\/[^/]*$/, "") || repoPath}
					onSelect={(p) => {
						setBrowsingPath(false);
						flushSave();
						setPathDraft(p);
						updateSlotPrompt({ source: "file", path: p });
					}}
					onClose={() => setBrowsingPath(false)}
				/>
			)}
		</FormProvider>
	);
}
