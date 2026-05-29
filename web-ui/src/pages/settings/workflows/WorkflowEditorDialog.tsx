import { Menu, MenuItem, MenuTrigger, RHFSwitch, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	AGENT_BINARY_OPTIONS,
	EFFORT_OPTIONS,
	EMPTY_INLINE_PROMPT,
	type PromptValue,
	type RuntimeAgentId,
	type Workflow,
} from "@runtime-contract";
import { type WorkflowForm, type WorkflowSlotForm, workflowFormSchema } from "@runtime-validation/workflow";
import {
	ArrowRight,
	Check,
	FileText,
	FolderOpen,
	Link as LinkIcon,
	Loader2,
	Plus,
	Star,
	Terminal,
	Trash2,
	Type,
	Workflow as WorkflowIcon,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, FormProvider, useFieldArray, useForm } from "react-hook-form";
import { FilePickerDialog } from "@/components/FilePickerDialog";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { ModelSelect } from "./ModelSelect";
import { defaultPromptPath, showPromptLinkDialog } from "./PromptLinkDialog";

function promptInlineText(prompt: PromptValue | undefined): string {
	return prompt?.source === "inline" ? prompt.text : "";
}

type SaveStatus = "idle" | "loading" | "unsaved" | "saving" | "saved" | "error";

function slotTypeColor(type: string): string {
	if (type === "dev") return "#3b82f6";
	if (type === "code_review") return "#f59e0b";
	if (type === "qa") return "#22c55e";
	if (type === "orch") return "#7c6aff";
	return "#8888a0";
}

function SaveIndicator({ status }: { status: SaveStatus }) {
	if (status === "saving" || status === "loading") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-[#60607a]">
				<Loader2 size={10} className="animate-spin" />
				{status === "loading" ? "Loading…" : "Saving…"}
			</span>
		);
	}
	if (status === "saved") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-emerald-500">
				<Check size={10} />
				Saved
			</span>
		);
	}
	if (status === "unsaved") {
		return <span className="text-[10px] text-amber-500">Unsaved…</span>;
	}
	if (status === "error") {
		return <span className="text-[10px] text-red-400">Save failed</span>;
	}
	return null;
}

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

	// File-linked prompt state. The slot only stores {source: "file", path};
	// the file content lives here in the editor and auto-saves back on edit.
	const [linkedContent, setLinkedContent] = useState("");
	const [pathDraft, setPathDraft] = useState("");
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const [browsingPath, setBrowsingPath] = useState(false);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingSaveRef = useRef<{ path: string; content: string } | null>(null);

	const { trigger: writePromptFile } = useWrite((api) => api("workflows/prompt-file").POST());
	// Lazy read: the builder needs a query shape, but the actual path is supplied
	// per-fetch via trigger({ query }).
	const { trigger: readPromptFile } = useRead(
		(api) => api("workflows/prompt-file").GET({ query: { workspaceId, path: "" } }),
		{ enabled: false },
	);

	const slotKey = `${selectedSlotId}::${selectedSlot?.prompt?.source ?? ""}::${
		selectedSlot?.prompt?.source === "file" ? selectedSlot.prompt.path : ""
	}`;

	const flushSave = () => {
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}
		const pending = pendingSaveRef.current;
		pendingSaveRef.current = null;
		if (!pending) return;
		setSaveStatus("saving");
		void writePromptFile({ body: { workspaceId, path: pending.path, content: pending.content } }).then((res) => {
			if (res.error) {
				setSaveStatus("error");
				toast.error(`Save failed: ${res.error.message}`);
			} else {
				setSaveStatus("saved");
			}
		});
	};

	const scheduleSave = (path: string, content: string) => {
		pendingSaveRef.current = { path, content };
		setSaveStatus("unsaved");
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => flushSave(), 500);
	};

	// Load file content when the selected slot (or its path) changes.
	useEffect(() => {
		if (!selectedSlot) return;
		if (selectedSlot.prompt.source !== "file") {
			setLinkedContent("");
			setPathDraft("");
			setSaveStatus("idle");
			return;
		}
		setPathDraft(selectedSlot.prompt.path);
		if (!selectedSlot.prompt.path) {
			setLinkedContent("");
			setSaveStatus("idle");
			return;
		}
		setSaveStatus("loading");
		void readPromptFile({ query: { workspaceId, path: selectedSlot.prompt.path } }).then((res) => {
			if (res.error) {
				setLinkedContent("");
				setSaveStatus("error");
				toast.error(`Couldn't read file: ${res.error.message}`);
			} else {
				setLinkedContent(res.data.content);
				setSaveStatus("saved");
			}
		});
		// slotKey covers id + source + path
	}, [slotKey, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

	// Flush any pending file save on unmount (closing the dialog).
	useEffect(() => {
		return () => {
			flushSave();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
		const defaults: Record<string, { id: string; name: string; enabled: boolean }> = {
			code_review: { id: "code_review", name: "Code Review", enabled: true },
			qa: { id: "qa", name: "QA", enabled: false },
			custom: { id: `slot_custom_${Date.now()}`, name: "Custom Agent", enabled: true },
			orch: { id: `slot_orch_${Date.now()}`, name: "Orch Agent", enabled: true },
		};
		const d = defaults[type]!;
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
							<div className="shrink-0 bg-[#3b82f615] rounded-[4px] px-2 py-[2px]">
								<span className="text-[10px] font-medium text-[#3b82f6]">{forStory ? "Story" : "Task"}</span>
							</div>
							<button onClick={onClose} className="hover:opacity-70 transition-opacity shrink-0">
								<X size={18} className="text-[#60607a]" />
							</button>
						</div>

						{/* Pipeline section */}
						<div className="shrink-0 px-6 py-4 border-b border-[#2a2a35]">
							{/* Pipeline header */}
							<div className="flex items-center gap-2 mb-3">
								<span className="text-[10px] font-semibold shrink-0 text-[#60607a] tracking-[1px]">PIPELINE</span>
								<div className="flex-1 h-px bg-[#1a1a1f]" />
								<Menu placement="bottom-end">
									<MenuTrigger>
										{({ toggleMenu }) => (
											<button
												onClick={toggleMenu}
												className="flex items-center gap-1 hover:opacity-80 transition-opacity bg-transparent border border-[#2a2a35] rounded-[4px] px-2 py-[3px]"
											>
												<Plus size={11} className="text-[#60607a]" />
												<span className="text-[10px] text-[#60607a]">Add Slot</span>
											</button>
										)}
									</MenuTrigger>
									{!forStory && !hasCR && <MenuItem onClick={() => addSlot("code_review")}>Code Review</MenuItem>}
									{!forStory && !hasQA && <MenuItem onClick={() => addSlot("qa")}>QA</MenuItem>}
									{!forStory && <MenuItem onClick={() => addSlot("custom")}>Custom Agent</MenuItem>}
									{forStory && <MenuItem onClick={() => addSlot("orch")}>Orch Agent</MenuItem>}
								</Menu>
							</div>
							{/* Slot pills */}
							<div className="flex items-center flex-wrap">
								{sortedSlots.map((slot, idx) => {
									const isSelected = slot.id === selectedSlotId;
									const isDisabled = !slot.enabled;
									const color = slotTypeColor(slot.type);
									return (
										<div key={slot.id} className="flex items-center">
											{idx > 0 && (
												<div className="flex items-center justify-center w-8">
													<ArrowRight size={14} className="text-[#2a2a35]" />
												</div>
											)}
											<button
												onClick={() => switchSlot(slot.id)}
												className={classNames(
													"flex items-center transition-colors rounded-lg px-3.5 py-2 gap-2",
													isSelected
														? "bg-[#7c6aff15] border-2 border-[#7c6aff]"
														: "bg-[#1a1a1f] border border-[#2a2a35]",
													isDisabled ? "opacity-40" : "",
												)}
											>
												<div
													className="flex items-center justify-center shrink-0 w-5 h-5 rounded-[10px]"
													style={{ background: isDisabled ? "#2a2a3525" : `${color}25` }}
												>
													<span className="text-[9px] font-bold" style={{ color: isDisabled ? "#4a4a5a" : color }}>
														{idx + 1}
													</span>
												</div>
												<span
													className={classNames(
														"text-[12px]",
														isSelected
															? "text-[#f0f0f5] font-semibold"
															: isDisabled
																? "text-[#4a4a5a]"
																: "text-[#8888a0]",
														isDisabled ? "line-through" : "",
													)}
												>
													{slot.name}
												</span>
											</button>
										</div>
									);
								})}
								{sortedSlots.length === 0 && (
									<span className="text-[12px] text-[#4a4a5a]">No slots — add one above</span>
								)}
							</div>
						</div>

						{/* Slot instructions editor */}
						{selectedSlot ? (
							<div className="flex-1 flex flex-col overflow-hidden px-6 py-5">
								{/* Header */}
								<div className="flex items-center gap-2 shrink-0 mb-3">
									<FileText size={14} className="shrink-0" style={{ color: slotTypeColor(selectedSlot.type) }} />
									<span className="text-[14px] font-semibold text-[#f0f0f5]">{selectedSlot.name} — Instructions</span>
									<div className="flex-1" />
									{selectedSlot.prompt.source === "file" ? (
										<SaveIndicator status={saveStatus} />
									) : (
										<>
											<span className="font-mono text-[10px] text-[#60607a]">
												{promptInlineText(selectedSlot.prompt).length} chars
											</span>
											<button
												onClick={handleLinkToFile}
												className="flex items-center gap-1.5 hover:opacity-80 transition-opacity bg-[#1a1a1f] border border-[#2a2a35] rounded-md px-2.5 py-1"
											>
												<LinkIcon size={11} className="text-[#7c6aff]" />
												<span className="text-[10px] text-[#c0c0d0]">Link to file</span>
											</button>
										</>
									)}
								</div>

								{/* File-linked path bar */}
								{selectedSlot.prompt.source === "file" && (
									<div className="shrink-0 mb-3 flex items-center gap-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2">
										<LinkIcon size={12} className="text-[#7c6aff] shrink-0" />
										<input
											type="text"
											value={pathDraft}
											onChange={(e) => setPathDraft(e.target.value)}
											onBlur={commitPathChange}
											onKeyDown={(e) => {
												if (e.key === "Enter") (e.target as HTMLInputElement).blur();
											}}
											placeholder="/path/to/repo/.whipped/prompts/dev.md"
											className="flex-1 bg-transparent outline-none font-mono text-[11px] text-[#c0c0d0]"
										/>
										<button
											onClick={() => setBrowsingPath(true)}
											title="Browse for a file"
											className="shrink-0 text-[#60607a] hover:text-[#7c6aff] transition-colors"
										>
											<FolderOpen size={13} />
										</button>
										<button
											onClick={handleDisconnect}
											title="Disconnect file (keep content as inline)"
											className="shrink-0 text-[#60607a] hover:text-red-400 transition-colors"
										>
											<X size={13} />
										</button>
									</div>
								)}

								{/* Editor box (shared by both modes) */}
								<div className="flex-1 flex flex-col overflow-hidden bg-[#0c0c0f] border border-[#2a2a35] rounded-lg p-5">
									{editorReady ? (
										<textarea
											value={editorText}
											onChange={(e) => handleEditorChange(e.target.value)}
											placeholder={
												selectedSlot.prompt.source === "file" && !pathDraft
													? "Enter a file path above to start editing..."
													: "Describe what this agent should check or do..."
											}
											disabled={selectedSlot.prompt.source === "file" && !selectedSlot.prompt.path}
											className="flex-1 bg-transparent resize-none outline-none font-mono text-[13px] text-[#c0c0d0] leading-relaxed w-full min-h-0 disabled:opacity-50"
										/>
									) : (
										<div className="flex-1 flex items-center justify-center gap-2 text-[12px] text-[#60607a]">
											<Loader2 size={14} className="animate-spin" />
											Loading file…
										</div>
									)}
								</div>

								{selectedSlot.prompt.source === "file" && (
									<p className="shrink-0 mt-2 text-[11px] text-[#60607a] leading-relaxed">
										Edits auto-save to the file and are also picked up if you edit it in your own editor. The agent
										reads this file at runtime.
									</p>
								)}
							</div>
						) : (
							<div className="flex-1 flex items-center justify-center text-[13px] text-[#4a4a5a]">
								Select a slot to edit its instructions
							</div>
						)}
					</div>

					{/* Right panel */}
					<div className="flex flex-col shrink-0 overflow-hidden w-[340px] bg-[#111115] border-l border-[#2a2a35]">
						{/* Header */}
						<div className="shrink-0 px-5 py-4 border-b border-[#2a2a35]">
							<span className="text-[13px] font-semibold text-[#f0f0f5]">Slot Configuration</span>
						</div>
						{selectedSlot ? (
							<div className="flex flex-col flex-1 overflow-y-auto p-5 gap-4">
								{/* Name */}
								<div className="flex flex-col gap-[5px]">
									<span className="text-[11px] font-medium text-[#60607a] tracking-[0.3px]">Name</span>
									<div className="flex items-center gap-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2">
										<Type size={13} className="text-[#60607a] shrink-0" />
										<input
											value={selectedSlot.name}
											onChange={(e) => updateSlot({ name: e.target.value })}
											readOnly={!nameEditable}
											className="flex-1 bg-transparent outline-none text-[12px]"
											style={{
												color: nameEditable ? "#c0c0d0" : "#60607a",
												cursor: nameEditable ? "text" : "default",
											}}
										/>
									</div>
								</div>
								{/* Agent Binary */}
								<div className="flex flex-col gap-[5px]">
									<span className="text-[11px] font-medium text-[#60607a] tracking-[0.3px]">Agent Binary</span>
									<div className="flex items-center gap-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2">
										<Terminal size={14} className="text-[#f59e0b] shrink-0" />
										<select
											value={selectedSlot.agentBinary}
											onChange={(e) => updateSlot({ agentBinary: e.target.value as RuntimeAgentId, model: null })}
											className="flex-1 bg-transparent outline-none text-[12px] text-[#c0c0d0]"
										>
											{AGENT_BINARY_OPTIONS.map((o) => (
												<option key={o.value} value={o.value}>
													{o.label}
												</option>
											))}
										</select>
									</div>
								</div>
								{/* Model */}
								<div className="flex flex-col gap-[5px]">
									<span className="text-[11px] font-medium text-[#60607a] tracking-[0.3px]">Model</span>
									<ModelSelect
										key={selectedSlot.agentBinary}
										agentId={selectedSlot.agentBinary}
										value={selectedSlot.model ?? ""}
										onChange={(v) => updateSlot({ model: v || null })}
									/>
								</div>
								{/* Effort */}
								<div className="flex flex-col gap-[5px]">
									<span className="text-[11px] font-medium text-[#60607a] tracking-[0.3px]">Effort</span>
									<div className="flex items-center bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2">
										<select
											value={selectedSlot.effort ?? ""}
											onChange={(e) => updateSlot({ effort: (e.target.value as WorkflowSlotForm["effort"]) || null })}
											className="flex-1 bg-transparent outline-none text-[12px] text-[#c0c0d0]"
										>
											<option value="">Default</option>
											{EFFORT_OPTIONS.map((o) => (
												<option key={o.value} value={o.value}>
													{o.label}
												</option>
											))}
										</select>
									</div>
								</div>
								{selectedSlot.type !== "dev" && (
									<>
										<div className="h-px bg-[#2a2a35] shrink-0" />
										{/* Enabled toggle */}
										<div className="flex items-center">
											<span className="text-[13px] text-[#c0c0d0]">Enabled</span>
											<div className="flex-1" />
											{selectedIndex >= 0 && <RHFSwitch name={`slots.${selectedIndex}.enabled`} />}
										</div>
									</>
								)}
								<div className="flex-1" />
								{/* Delete + Save */}
								<div className="flex items-center justify-end gap-2 shrink-0">
									{selectedSlot.type !== "dev" && (
										<button
											onClick={handleDeleteSlot}
											className="flex items-center gap-[5px] hover:opacity-80 transition-opacity bg-transparent border border-[#ef444440] rounded-md px-3.5 py-2"
										>
											<Trash2 size={13} className="text-[#ef4444]" />
											<span className="text-[12px] text-[#ef4444]">Delete</span>
										</button>
									)}
									<button
										onClick={handleSave}
										className="flex items-center gap-[5px] hover:opacity-80 transition-opacity bg-[#7c6aff] rounded-md px-4 py-2"
									>
										<Check size={13} className="text-white" />
										<span className="text-[12px] font-medium text-white">{isNew ? "Create" : "Save"}</span>
									</button>
								</div>
							</div>
						) : (
							<div className="flex-1 flex items-center justify-center text-[12px] text-[#4a4a5a]">
								Select a slot to configure
							</div>
						)}
					</div>
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
