import { Menu, MenuItem, MenuTrigger } from "@geckoui/geckoui";
import {
	AGENT_BINARY_OPTIONS,
	EFFORT_OPTIONS,
	type EffortLevel,
	type RuntimeAgentId,
	type Workflow,
	type WorkflowSlot,
} from "@runtime-contract";
import {
	ArrowRight,
	Check,
	FileText,
	Plus,
	Star,
	Terminal,
	Trash2,
	Type,
	Workflow as WorkflowIcon,
	X,
} from "lucide-react";
import { useState } from "react";
import { classNames } from "@/utils/classNames";
import { ModelSelect } from "./ModelSelect";

function slotTypeColor(type: string): string {
	if (type === "dev") return "#3b82f6";
	if (type === "code_review") return "#f59e0b";
	if (type === "qa") return "#22c55e";
	if (type === "orch") return "#7c6aff";
	return "#8888a0";
}

export function WorkflowEditorDialog({
	workflow,
	defaultBinary,
	isNew = false,
	// biome-ignore lint/correctness/noUnusedFunctionParameters: required by caller interface
	onUpdate,
	onSave,
	onClose,
}: {
	workflow: Workflow;
	defaultBinary: RuntimeAgentId;
	isNew?: boolean;
	onUpdate: (wf: Workflow) => void;
	onSave: (wf: Workflow) => void;
	onClose: () => void;
}) {
	const [localWorkflow, setLocalWorkflow] = useState<Workflow>(workflow);
	const sortedSlots = [...localWorkflow.slots].sort((a, b) => a.order - b.order);
	const [selectedSlotId, setSelectedSlotId] = useState<string>(sortedSlots[0]?.id ?? "");

	const selectedSlot = localWorkflow.slots.find((s) => s.id === selectedSlotId);

	const updateSlot = (patch: Partial<WorkflowSlot>) => {
		setLocalWorkflow((prev) => ({
			...prev,
			slots: prev.slots.map((s) => (s.id === selectedSlotId ? { ...s, ...patch } : s)),
		}));
	};

	const handleSave = () => {
		onSave(localWorkflow);
		onClose();
	};

	const handleDeleteSlot = () => {
		const remaining = localWorkflow.slots.filter((s) => s.id !== selectedSlotId);
		const devs = remaining.filter((s) => s.type === "dev");
		const others = remaining.filter((s) => s.type !== "dev").map((s, i) => ({ ...s, order: i + 1 }));
		const updated = [...devs, ...others];
		setLocalWorkflow((prev) => ({ ...prev, slots: updated }));
		setSelectedSlotId(updated[0]?.id ?? "");
	};

	const hasCR = localWorkflow.slots.some((s) => s.type === "code_review");
	const hasQA = localWorkflow.slots.some((s) => s.type === "qa");

	const addSlot = (type: "code_review" | "qa" | "custom" | "orch") => {
		const maxOrder = localWorkflow.slots.reduce((m, s) => Math.max(m, s.order), 0);
		const defaults: Record<string, { id: string; name: string; enabled: boolean }> = {
			code_review: { id: "code_review", name: "Code Review", enabled: true },
			qa: { id: "qa", name: "QA", enabled: false },
			custom: { id: `slot_custom_${Date.now()}`, name: "Custom Agent", enabled: true },
			orch: { id: `slot_orch_${Date.now()}`, name: "Orch Agent", enabled: true },
		};
		const d = defaults[type]!;
		const newSlot: WorkflowSlot = {
			id: d.id,
			name: d.name,
			type,
			agentBinary: defaultBinary,
			order: maxOrder + 1,
			enabled: d.enabled,
			prompt: "",
		};
		const updated = [...localWorkflow.slots, newSlot];
		setLocalWorkflow((prev) => ({ ...prev, slots: updated }));
		setSelectedSlotId(newSlot.id);
	};

	return (
		<>
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
							<input
								value={localWorkflow.name}
								onChange={(e) => setLocalWorkflow((prev) => ({ ...prev, name: e.target.value }))}
								className="bg-transparent outline-none text-[17px] font-semibold min-w-0 flex-1 text-[#f0f0f5]"
								placeholder="Workflow name"
							/>
							{localWorkflow.isDefault && (
								<div className="flex items-center gap-1 shrink-0 bg-[#eab30815] rounded-[4px] px-2 py-[2px]">
									<Star size={10} className="text-[#eab308]" />
									<span className="text-[10px] font-medium text-[#eab308]">Default</span>
								</div>
							)}
							<div className="shrink-0 bg-[#3b82f615] rounded-[4px] px-2 py-[2px]">
								<span className="text-[10px] font-medium text-[#3b82f6]">
									{localWorkflow.forStory ? "Story" : "Task"}
								</span>
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
									{!localWorkflow.forStory && !hasCR && (
										<MenuItem onClick={() => addSlot("code_review")}>Code Review</MenuItem>
									)}
									{!localWorkflow.forStory && !hasQA && <MenuItem onClick={() => addSlot("qa")}>QA</MenuItem>}
									{!localWorkflow.forStory && <MenuItem onClick={() => addSlot("custom")}>Custom Agent</MenuItem>}
									{localWorkflow.forStory && <MenuItem onClick={() => addSlot("orch")}>Orch Agent</MenuItem>}
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
												onClick={() => setSelectedSlotId(slot.id)}
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
									<span className="font-mono text-[10px] text-[#60607a]">
										{(selectedSlot.prompt ?? "").length} chars
									</span>
								</div>
								{/* Textarea box */}
								<div className="flex-1 flex flex-col overflow-hidden bg-[#0c0c0f] border border-[#2a2a35] rounded-lg p-5">
									<textarea
										value={selectedSlot.prompt ?? ""}
										onChange={(e) => updateSlot({ prompt: e.target.value })}
										placeholder="Describe what this agent should check or do..."
										className="flex-1 bg-transparent resize-none outline-none font-mono text-[13px] text-[#c0c0d0] leading-relaxed w-full min-h-0"
									/>
								</div>
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
											readOnly={selectedSlot.type !== "custom" && selectedSlot.type !== "orch"}
											className="flex-1 bg-transparent outline-none text-[12px]"
											style={{
												color: selectedSlot.type === "custom" || selectedSlot.type === "orch" ? "#c0c0d0" : "#60607a",
												cursor: selectedSlot.type === "custom" || selectedSlot.type === "orch" ? "text" : "default",
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
											onChange={(e) => updateSlot({ effort: (e.target.value as EffortLevel) || null })}
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
											<button
												type="button"
												onClick={() => updateSlot({ enabled: !selectedSlot.enabled })}
												className={classNames(
													"w-9 h-5 rounded-[10px] p-0.5 flex items-center transition-colors",
													selectedSlot.enabled ? "bg-[#22c55e] justify-end" : "bg-[#2a2a35] justify-start",
												)}
											>
												<div className="w-4 h-4 rounded-full bg-white" />
											</button>
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
		</>
	);
}
