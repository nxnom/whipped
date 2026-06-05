import type { RuntimeAgentId } from "@runtime-contract";
import type { ModelPairForm, WorkflowSlotForm } from "@runtime-validation/workflow";

type SlotType = "review" | "plan" | "orch";

export function slotDefaults(type: SlotType): { id: string; name: string; enabled: boolean } {
	const defaults: Record<SlotType, { id: string; name: string; enabled: boolean }> = {
		review: { id: `slot_review_${Date.now()}`, name: "Review", enabled: true },
		plan: { id: "plan", name: "Plan", enabled: true },
		orch: { id: `slot_orch_${Date.now()}`, name: "Orch Agent", enabled: true },
	};
	return defaults[type];
}

// A fresh slot always needs at least one model tier. Seed a single medium-level
// pair on the given binary; the user tweaks/adds tiers in the config panel.
export function defaultPair(binary: RuntimeAgentId): ModelPairForm {
	return { id: `pair_${Date.now()}`, level: "medium", isFree: false, binary, model: null, effort: null };
}

export function defaultSlotModelFields(binary: RuntimeAgentId): Pick<WorkflowSlotForm, "pairs" | "mode"> {
	return { pairs: [defaultPair(binary)], mode: "auto" };
}
