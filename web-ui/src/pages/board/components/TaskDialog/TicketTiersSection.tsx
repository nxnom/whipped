import { RHFInputGroup, RHFSelect, Select, SelectOption } from "@geckoui/geckoui";
import {
	PAIR_SELECTION_MODE_OPTIONS,
	type PairSelectionMode,
	type RuntimeAgentId,
	TIER_LEVEL_OPTIONS,
	type Workflow,
} from "@runtime-contract";
import type { CardModelConfigForm, CreateTaskForm } from "@runtime-validation/card";
import type { ModelPairForm } from "@runtime-validation/workflow";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { ModelTiersDialog } from "@/pages/settings/workflows/WorkflowEditorDialog/ModelTiersDialog";
import { LEVEL_COLOR } from "@/utils/levelColor";
import { snapshotFormModelConfig } from "./tiers";

// Highest capability first.
const LEVELS_DESC = [...TIER_LEVEL_OPTIONS].reverse();

// Per-ticket model tiers: the workflow-wide active level, plus per-slot a merged
// selector — pick a mode (auto/prefer free/…) or pin a specific pair (overrides
// mode). Pairs themselves are edited via the shared ModelTiersDialog.
export function TicketTiersSection({ workflow }: { workflow: Workflow | undefined }) {
	const { control, setValue } = useFormContext<CreateTaskForm>();
	const modelConfig = (useWatch({ control, name: "modelConfig" }) as CardModelConfigForm | undefined) ?? {};
	const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

	if (!workflow) return null;

	const defaultBinary: RuntimeAgentId =
		workflow.slots.find((s) => s.type === "dev")?.pairs[0]?.binary ?? workflow.slots[0]?.pairs[0]?.binary ?? "claude";

	const cfgFor = (slotId: string) => modelConfig[slotId] ?? snapshotFormModelConfig(workflow)[slotId];

	const editingCfg = editingSlotId ? cfgFor(editingSlotId) : undefined;

	const updateSlotCfg = (slotId: string, patch: Partial<CardModelConfigForm[string]>) => {
		const sc = cfgFor(slotId);
		if (!sc) return;
		setValue("modelConfig", { ...modelConfig, [slotId]: { ...sc, ...patch } }, { shouldDirty: true });
	};

	const saveSlotPairs = (slotId: string, pairs: ModelPairForm[]) => {
		const sc = cfgFor(slotId);
		// Drop a pin that no longer points at an existing pair.
		const pinnedPairId = sc?.pinnedPairId && pairs.some((p) => p.id === sc.pinnedPairId) ? sc.pinnedPairId : undefined;
		setValue(
			"modelConfig",
			{ ...modelConfig, [slotId]: { pairs, mode: sc?.mode ?? "auto", pinnedPairId } },
			{
				shouldDirty: true,
			},
		);
	};

	const onSelectChange = (slotId: string, value: string) => {
		if (value.startsWith("p:")) updateSlotCfg(slotId, { pinnedPairId: value.slice(2) });
		else updateSlotCfg(slotId, { mode: value.slice(2) as PairSelectionMode, pinnedPairId: undefined });
	};

	const sortedSlots = [...workflow.slots].sort((a, b) => {
		if (a.type === "plan" && b.type !== "plan") return -1;
		if (b.type === "plan" && a.type !== "plan") return 1;
		return a.order - b.order;
	});

	return (
		<div className="flex flex-col gap-2">
			<span className="text-[11px] font-medium text-[#5f6672]">Model tiers</span>
			<RHFInputGroup
				label="Level"
				labelClassName="text-[10px] font-medium text-[#5f6672] tracking-[0.3px] uppercase"
				className="flex flex-col gap-1"
				errorClassName="text-[11px] text-[#ff3b4d] mt-1"
			>
				<RHFSelect name="activeLevel" placeholder="Select a level…">
					{LEVELS_DESC.map((o) => (
						<SelectOption key={o.value} value={o.value} label={o.label}>
							<span className="flex items-center gap-2">
								<span className="size-2 rounded-full shrink-0" style={{ background: LEVEL_COLOR[o.value] }} />
								{o.label}
							</span>
						</SelectOption>
					))}
				</RHFSelect>
			</RHFInputGroup>
			<div className="flex flex-col gap-2">
				{sortedSlots.map((slot) => {
					const sc = cfgFor(slot.id);
					if (!sc) return null;
					const value = sc.pinnedPairId ? `p:${sc.pinnedPairId}` : `m:${sc.mode}`;
					return (
						<div key={slot.id} className="flex flex-col gap-1 bg-[#111111] border border-[#2a2a2a] rounded-md p-2">
							<div className="flex items-center gap-2">
								<span className="text-[12px] text-[#ededed]">{slot.name}</span>
								<div className="flex-1" />
								<button
									type="button"
									onClick={() => setEditingSlotId(slot.id)}
									className="flex items-center gap-1 hover:opacity-80 transition-opacity bg-transparent border border-[#2a2a2a] rounded-[4px] px-2 py-[3px]"
								>
									<Pencil size={11} className="text-[#5f6672]" />
									<span className="text-[10px] text-[#5f6672]">Edit tiers</span>
								</button>
							</div>
							<Select value={value} onChange={(v) => onSelectChange(slot.id, v)}>
								{PAIR_SELECTION_MODE_OPTIONS.map((o) => (
									<SelectOption key={o.value} value={`m:${o.value}`} label={o.label} />
								))}
								{sc.pairs.map((p) => (
									<SelectOption
										key={p.id}
										value={`p:${p.id}`}
										label={`Pin: ${p.binary}${p.model ? `/${p.model}` : ""} @${p.level}${p.isFree ? " (free)" : ""}`}
									/>
								))}
							</Select>
						</div>
					);
				})}
			</div>
			{editingSlotId && editingCfg && (
				<ModelTiersDialog
					pairs={editingCfg.pairs}
					defaultBinary={defaultBinary}
					onSave={(pairs) => saveSlotPairs(editingSlotId, pairs)}
					onClose={() => setEditingSlotId(null)}
				/>
			)}
		</div>
	);
}
