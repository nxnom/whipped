import { Select, SelectOption } from "@geckoui/geckoui";
import { type RuntimeAgentId, type TierLevel, TIER_LEVEL_OPTIONS, type Workflow } from "@runtime-contract";
import type { CardModelConfigForm, CreateTaskForm } from "@runtime-validation/card";
import type { ModelPairForm } from "@runtime-validation/workflow";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { ModelTiersDialog } from "@/pages/settings/workflows/WorkflowEditorDialog/ModelTiersDialog";
import { snapshotFormModelConfig } from "./tiers";

// Per-ticket model tiers editor for the create/edit task dialogs. The active level
// and each slot's tiers (snapshotted from the workflow) are held in the form and
// edited via the shared ModelTiersDialog.
export function TicketTiersSection({ workflow }: { workflow: Workflow | undefined }) {
	const { control, setValue } = useFormContext<CreateTaskForm>();
	const activeLevel = useWatch({ control, name: "activeLevel" });
	const modelConfig = (useWatch({ control, name: "modelConfig" }) as CardModelConfigForm | undefined) ?? {};
	const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

	if (!workflow) return null;

	const defaultBinary: RuntimeAgentId =
		workflow.slots.find((s) => s.type === "dev")?.pairs[0]?.binary ?? workflow.slots[0]?.pairs[0]?.binary ?? "claude";

	const editingCfg = editingSlotId
		? (modelConfig[editingSlotId] ?? snapshotFormModelConfig(workflow)[editingSlotId])
		: undefined;

	const saveSlot = (slotId: string, pairs: ModelPairForm[], defaultPairId: string) => {
		setValue(
			"modelConfig",
			{ ...modelConfig, [slotId]: { pairs, defaultPairId, preferFree: modelConfig[slotId]?.preferFree ?? false } },
			{ shouldDirty: true },
		);
	};

	const sortedSlots = [...workflow.slots].sort((a, b) => {
		if (a.type === "plan" && b.type !== "plan") return -1;
		if (b.type === "plan" && a.type !== "plan") return 1;
		return a.order - b.order;
	});

	return (
		<div className="flex flex-col gap-2">
			<span className="text-[11px] font-medium text-[#60607a]">Model tiers</span>
			<Select value={activeLevel} onChange={(v) => setValue("activeLevel", v as TierLevel, { shouldDirty: true })}>
				{TIER_LEVEL_OPTIONS.map((o) => (
					<SelectOption key={o.value} value={o.value} label={`Level: ${o.label}`} />
				))}
			</Select>
			<div className="flex flex-col gap-1.5">
				{sortedSlots.map((slot) => {
					const sc = modelConfig[slot.id];
					const def = sc?.pairs.find((p) => p.id === sc.defaultPairId) ?? sc?.pairs[0];
					return (
						<div
							key={slot.id}
							className="flex items-center gap-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2"
						>
							<span className="text-[12px] text-[#c0c0d0] shrink-0">{slot.name}</span>
							<span className="text-[11px] text-[#60607a] truncate">
								{def ? `${def.binary}${def.model ? `/${def.model}` : ""}` : ""}
							</span>
							<div className="flex-1" />
							{def?.isFree && (
								<span className="shrink-0 text-[9px] font-medium text-[#22c55e] bg-[#22c55e15] rounded px-1.5 py-[1px]">
									Free
								</span>
							)}
							<button
								type="button"
								onClick={() => setEditingSlotId(slot.id)}
								className="flex items-center gap-1 hover:opacity-80 transition-opacity bg-transparent border border-[#2a2a35] rounded-[4px] px-2 py-[3px]"
							>
								<Pencil size={11} className="text-[#60607a]" />
								<span className="text-[10px] text-[#60607a]">Edit</span>
							</button>
						</div>
					);
				})}
			</div>
			{editingSlotId && editingCfg && (
				<ModelTiersDialog
					pairs={editingCfg.pairs}
					defaultPairId={editingCfg.defaultPairId}
					defaultBinary={defaultBinary}
					onSave={(pairs, defaultPairId) => saveSlot(editingSlotId, pairs, defaultPairId)}
					onClose={() => setEditingSlotId(null)}
				/>
			)}
		</div>
	);
}
