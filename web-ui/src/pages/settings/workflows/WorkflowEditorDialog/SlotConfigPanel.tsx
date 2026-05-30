import { RHFSwitch } from "@geckoui/geckoui";
import { AGENT_BINARY_OPTIONS, EFFORT_OPTIONS, type RuntimeAgentId } from "@runtime-contract";
import type { WorkflowSlotForm } from "@runtime-validation/workflow";
import { Check, Terminal, Trash2, Type } from "lucide-react";
import { ModelSelect } from "../ModelSelect";

export function SlotConfigPanel({
	selectedSlot,
	selectedIndex,
	nameEditable,
	isNew,
	updateSlot,
	onDeleteSlot,
	onSave,
}: {
	selectedSlot: WorkflowSlotForm | undefined;
	selectedIndex: number;
	nameEditable: boolean;
	isNew: boolean;
	updateSlot: (patch: Partial<WorkflowSlotForm>) => void;
	onDeleteSlot: () => void;
	onSave: () => void;
}) {
	return (
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
								onClick={onDeleteSlot}
								className="flex items-center gap-[5px] hover:opacity-80 transition-opacity bg-transparent border border-[#ef444440] rounded-md px-3.5 py-2"
							>
								<Trash2 size={13} className="text-[#ef4444]" />
								<span className="text-[12px] text-[#ef4444]">Delete</span>
							</button>
						)}
						<button
							onClick={onSave}
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
	);
}
