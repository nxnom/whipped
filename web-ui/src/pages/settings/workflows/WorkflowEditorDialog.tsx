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
	Workflow as WorkflowIcon,
	X,
} from "lucide-react";
import { useState } from "react";
import { AddCustomAgentDialog } from "./AddCustomAgentDialog";
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
	const [addingCustom, setAddingCustom] = useState<"custom" | "orch" | null>(null);

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

	const addBuiltinSlot = (type: "code_review" | "qa") => {
		const maxOrder = localWorkflow.slots.reduce((m, s) => Math.max(m, s.order), 0);
		const defaults = {
			code_review: { id: "code_review", name: "Code Review" },
			qa: { id: "qa", name: "QA" },
		};
		const d = defaults[type];
		const newSlot: WorkflowSlot = {
			...d,
			type,
			agentBinary: defaultBinary,
			order: maxOrder + 1,
			enabled: type !== "qa",
			prompt: "",
		};
		const updated = [...localWorkflow.slots, newSlot];
		setLocalWorkflow((prev) => ({ ...prev, slots: updated }));
		setSelectedSlotId(newSlot.id);
		if (!isNew) onUpdate({ ...localWorkflow, slots: updated });
	};

	return (
		<>
			<div
				className="fixed inset-0 z-50 flex items-center justify-center"
				style={{ background: "rgba(0,0,0,0.7)" }}
				onClick={onClose}
			>
				<div
					className="flex overflow-hidden"
					style={{
						background: "#141418",
						borderRadius: 12,
						border: "1px solid #2a2a35",
						width: "87.5vw",
						maxWidth: 1400,
						height: "89.5vh",
						maxHeight: 850,
						boxShadow: "0 8px 40px 4px rgba(0,0,0,0.38)",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{/* Left panel */}
					<div className="flex-1 flex flex-col overflow-hidden">
						{/* Dialog header */}
						<div
							className="flex items-center gap-3 shrink-0"
							style={{ padding: "16px 24px", borderBottom: "1px solid #2a2a35" }}
						>
							<WorkflowIcon size={18} style={{ color: "#7c6aff", flexShrink: 0 }} />
							<input
								value={localWorkflow.name}
								onChange={(e) =>
									setLocalWorkflow((prev) => ({ ...prev, name: e.target.value }))
								}
								className="bg-transparent outline-none text-[17px] font-semibold min-w-0"
								style={{ color: "#f0f0f5", flex: 1 }}
								placeholder="Workflow name"
							/>
							{localWorkflow.isDefault && (
								<div
									className="flex items-center gap-1 shrink-0"
									style={{ background: "#eab30815", borderRadius: 4, padding: "2px 8px" }}
								>
									<Star size={10} style={{ color: "#eab308" }} />
									<span className="text-[10px] font-medium" style={{ color: "#eab308" }}>
										Default
									</span>
								</div>
							)}
							<div
								className="shrink-0"
								style={{ background: "#3b82f615", borderRadius: 4, padding: "2px 8px" }}
							>
								<span className="text-[10px] font-medium" style={{ color: "#3b82f6" }}>
									{localWorkflow.forStory ? "Story" : "Task"}
								</span>
							</div>
							<button onClick={onClose} className="hover:opacity-70 transition-opacity shrink-0">
								<X size={18} style={{ color: "#60607a" }} />
							</button>
						</div>

						{/* Pipeline section */}
						<div className="shrink-0" style={{ padding: "16px 24px", borderBottom: "1px solid #2a2a35" }}>
							{/* Pipeline header */}
							<div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
								<span
									className="text-[10px] font-semibold shrink-0"
									style={{ color: "#60607a", letterSpacing: 1 }}
								>
									PIPELINE
								</span>
								<div style={{ flex: 1, height: 1, background: "#1a1a1f" }} />
								<Menu placement="bottom-end">
									<MenuTrigger>
										{({ toggleMenu }) => (
											<button
												onClick={toggleMenu}
												className="flex items-center gap-1 hover:opacity-80 transition-opacity"
												style={{
													background: "transparent",
													border: "1px solid #2a2a35",
													borderRadius: 4,
													padding: "3px 8px",
												}}
											>
												<Plus size={11} style={{ color: "#60607a" }} />
												<span className="text-[10px]" style={{ color: "#60607a" }}>
													Add Slot
												</span>
											</button>
										)}
									</MenuTrigger>
									{!localWorkflow.forStory && !hasCR && (
										<MenuItem onClick={() => addBuiltinSlot("code_review")}>Code Review</MenuItem>
									)}
									{!localWorkflow.forStory && !hasQA && (
										<MenuItem onClick={() => addBuiltinSlot("qa")}>QA</MenuItem>
									)}
									{!localWorkflow.forStory && (
										<MenuItem onClick={() => setAddingCustom("custom")}>Custom Agent</MenuItem>
									)}
									{localWorkflow.forStory && (
										<MenuItem onClick={() => setAddingCustom("orch")}>Orch Agent</MenuItem>
									)}
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
												<div className="flex items-center justify-center" style={{ width: 32 }}>
													<ArrowRight size={14} style={{ color: "#2a2a35" }} />
												</div>
											)}
											<button
												onClick={() => setSelectedSlotId(slot.id)}
												className="flex items-center transition-colors"
												style={{
													background: isSelected ? "#7c6aff15" : "#1a1a1f",
													borderRadius: 8,
													padding: "8px 14px",
													border: isSelected ? "2px solid #7c6aff" : "1px solid #2a2a35",
													gap: 8,
													opacity: isDisabled ? 0.4 : 1,
												}}
											>
												<div
													className="flex items-center justify-center shrink-0"
													style={{
														width: 20,
														height: 20,
														borderRadius: 10,
														background: isDisabled ? "#2a2a3525" : `${color}25`,
													}}
												>
													<span
														className="text-[9px] font-bold"
														style={{ color: isDisabled ? "#4a4a5a" : color }}
													>
														{idx + 1}
													</span>
												</div>
												<span
													className="text-[12px]"
													style={{
														color: isSelected ? "#f0f0f5" : isDisabled ? "#4a4a5a" : "#8888a0",
														fontWeight: isSelected ? 600 : 400,
														textDecoration: isDisabled ? "line-through" : "none",
													}}
												>
													{slot.name}
												</span>
											</button>
										</div>
									);
								})}
								{sortedSlots.length === 0 && (
									<span className="text-[12px]" style={{ color: "#4a4a5a" }}>
										No slots — add one above
									</span>
								)}
							</div>
						</div>

						{/* Slot instructions editor */}
						{selectedSlot ? (
							<div className="flex-1 flex flex-col overflow-hidden" style={{ padding: "20px 24px" }}>
								{/* Header */}
								<div className="flex items-center gap-2 shrink-0" style={{ marginBottom: 12 }}>
									<FileText
										size={14}
										style={{ color: slotTypeColor(selectedSlot.type), flexShrink: 0 }}
									/>
									<span className="text-[14px] font-semibold" style={{ color: "#f0f0f5" }}>
										{selectedSlot.name} — Instructions
									</span>
									<div style={{ flex: 1 }} />
									<span className="font-mono text-[10px]" style={{ color: "#60607a" }}>
										{(selectedSlot.prompt ?? "").length} chars
									</span>
								</div>
								{/* Textarea box */}
								<div
									className="flex-1 flex flex-col overflow-hidden"
									style={{
										background: "#0c0c0f",
										border: "1px solid #2a2a35",
										borderRadius: 8,
										padding: "16px 20px",
									}}
								>
									<textarea
										value={selectedSlot.prompt ?? ""}
										onChange={(e) => updateSlot({ prompt: e.target.value })}
										placeholder="Describe what this agent should check or do..."
										className="flex-1 bg-transparent resize-none outline-none font-mono text-[13px]"
										style={{ color: "#c0c0d0", lineHeight: 1.6, width: "100%", minHeight: 0 }}
									/>
								</div>
							</div>
						) : (
							<div
								className="flex-1 flex items-center justify-center text-[13px]"
								style={{ color: "#4a4a5a" }}
							>
								Select a slot to edit its instructions
							</div>
						)}
					</div>

					{/* Right panel */}
					<div
						className="flex flex-col shrink-0 overflow-hidden"
						style={{ width: 340, background: "#111115", borderLeft: "1px solid #2a2a35" }}
					>
						{/* Header */}
						<div className="shrink-0" style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a35" }}>
							<span className="text-[13px] font-semibold" style={{ color: "#f0f0f5" }}>
								Slot Configuration
							</span>
						</div>
						{selectedSlot ? (
							<div
								className="flex flex-col flex-1 overflow-y-auto"
								style={{ padding: "16px 20px", gap: 16 }}
							>
								{/* Agent Binary */}
								<div className="flex flex-col" style={{ gap: 5 }}>
									<span
										className="text-[11px] font-medium"
										style={{ color: "#60607a", letterSpacing: 0.3 }}
									>
										Agent Binary
									</span>
									<div
										className="flex items-center gap-2"
										style={{
											background: "#0c0c0f",
											border: "1px solid #2a2a35",
											borderRadius: 6,
											padding: "8px 12px",
										}}
									>
										<Terminal size={14} style={{ color: "#f59e0b", flexShrink: 0 }} />
										<select
											value={selectedSlot.agentBinary}
											onChange={(e) =>
												updateSlot({ agentBinary: e.target.value as RuntimeAgentId, model: null })
											}
											className="flex-1 bg-transparent outline-none text-[12px]"
											style={{ color: "#c0c0d0" }}
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
								<div className="flex flex-col" style={{ gap: 5 }}>
									<span
										className="text-[11px] font-medium"
										style={{ color: "#60607a", letterSpacing: 0.3 }}
									>
										Model
									</span>
									<ModelSelect
										key={selectedSlot.agentBinary}
										agentId={selectedSlot.agentBinary}
										value={selectedSlot.model ?? ""}
										onChange={(v) => updateSlot({ model: v || null })}
									/>
								</div>
								{/* Effort */}
								<div className="flex flex-col" style={{ gap: 5 }}>
									<span
										className="text-[11px] font-medium"
										style={{ color: "#60607a", letterSpacing: 0.3 }}
									>
										Effort
									</span>
									<div
										className="flex items-center"
										style={{
											background: "#0c0c0f",
											border: "1px solid #2a2a35",
											borderRadius: 6,
											padding: "8px 12px",
										}}
									>
										<select
											value={selectedSlot.effort ?? ""}
											onChange={(e) =>
												updateSlot({ effort: (e.target.value as EffortLevel) || null })
											}
											className="flex-1 bg-transparent outline-none text-[12px]"
											style={{ color: "#c0c0d0" }}
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
										<div style={{ height: 1, background: "#2a2a35", flexShrink: 0 }} />
										{/* Enabled toggle */}
										<div className="flex items-center">
											<span className="text-[13px]" style={{ color: "#c0c0d0" }}>
												Enabled
											</span>
											<div style={{ flex: 1 }} />
											<button
												type="button"
												onClick={() => updateSlot({ enabled: !selectedSlot.enabled })}
												style={{
													width: 36,
													height: 20,
													borderRadius: 10,
													background: selectedSlot.enabled ? "#22c55e" : "#2a2a35",
													padding: 2,
													display: "flex",
													alignItems: "center",
													justifyContent: selectedSlot.enabled ? "flex-end" : "flex-start",
													transition: "background 0.15s",
													border: "none",
													cursor: "pointer",
												}}
											>
												<div
													style={{ width: 16, height: 16, borderRadius: "50%", background: "#ffffff" }}
												/>
											</button>
										</div>
									</>
								)}
								<div style={{ flex: 1 }} />
								{/* Delete + Save */}
								<div className="flex items-center justify-end gap-2 shrink-0">
									{selectedSlot.type !== "dev" && (
										<button
											onClick={handleDeleteSlot}
											className="flex items-center gap-[5px] hover:opacity-80 transition-opacity"
											style={{
												background: "transparent",
												border: "1px solid #ef444440",
												borderRadius: 6,
												padding: "8px 14px",
											}}
										>
											<Trash2 size={13} style={{ color: "#ef4444" }} />
											<span className="text-[12px]" style={{ color: "#ef4444" }}>
												Delete
											</span>
										</button>
									)}
									<button
										onClick={handleSave}
										className="flex items-center gap-[5px] hover:opacity-80 transition-opacity"
										style={{ background: "#7c6aff", borderRadius: 6, padding: "8px 16px" }}
									>
										<Check size={13} style={{ color: "#ffffff" }} />
										<span className="text-[12px] font-medium" style={{ color: "#ffffff" }}>
											{isNew ? "Create" : "Save"}
										</span>
									</button>
								</div>
							</div>
						) : (
							<div
								className="flex-1 flex items-center justify-center text-[12px]"
								style={{ color: "#4a4a5a" }}
							>
								Select a slot to configure
							</div>
						)}
					</div>
				</div>
			</div>

			{addingCustom !== null && (
				<AddCustomAgentDialog
					defaultBinary={defaultBinary}
					title={addingCustom === "orch" ? "Add Orch Agent" : "Add Custom Agent"}
					onAdd={(name, binary, model, effort, prompt) => {
						const maxOrder = localWorkflow.slots.reduce((m, s) => Math.max(m, s.order), 0);
						const slotType = addingCustom === "orch" ? "orch" : "custom";
						const newSlot: WorkflowSlot = {
							id: `slot_${slotType}_${Date.now()}`,
							type: slotType,
							name,
							agentBinary: binary,
							model,
							effort,
							order: maxOrder + 1,
							enabled: true,
							prompt,
						};
						const updated = [...localWorkflow.slots, newSlot];
						setLocalWorkflow((prev) => ({ ...prev, slots: updated }));
						setSelectedSlotId(newSlot.id);
						if (!isNew) onUpdate({ ...localWorkflow, slots: updated });
						setAddingCustom(null);
					}}
					onClose={() => setAddingCustom(null)}
				/>
			)}
		</>
	);
}
