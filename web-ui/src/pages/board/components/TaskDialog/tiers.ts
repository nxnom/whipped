import { type CardModelConfig, LEVEL_ORDER, type TierLevel, type Workflow } from "@runtime-contract";
import type { CardModelConfigForm } from "@runtime-validation/card";

// The highest tier present across the workflow's pairs — used as the create
// dialog's default level so the strongest configured models run unless lowered.
export function highestWorkflowLevel(workflow: Workflow | undefined): TierLevel {
	let bestIdx = -1;
	for (const slot of workflow?.slots ?? []) {
		for (const p of slot.pairs) bestIdx = Math.max(bestIdx, LEVEL_ORDER.indexOf(p.level));
	}
	return LEVEL_ORDER[bestIdx] ?? "medium";
}

// Snapshot a workflow's per-slot model config into the form shape (model/effort
// coerced to null so RHF input/output types stay identical).
export function snapshotFormModelConfig(workflow: Workflow | undefined): CardModelConfigForm {
	const cfg: CardModelConfigForm = {};
	for (const slot of workflow?.slots ?? []) {
		cfg[slot.id] = {
			pairs: slot.pairs.map((p) => ({
				id: p.id,
				level: p.level,
				isFree: p.isFree,
				binary: p.binary,
				model: p.model ?? null,
				effort: p.effort ?? null,
			})),
			mode: slot.mode,
		};
	}
	return cfg;
}

// Convert a card's saved model config into the form shape.
export function cardToFormModelConfig(cfg: CardModelConfig | undefined): CardModelConfigForm {
	const out: CardModelConfigForm = {};
	for (const [slotId, sc] of Object.entries(cfg ?? {})) {
		out[slotId] = {
			pairs: sc.pairs.map((p) => ({
				id: p.id,
				level: p.level,
				isFree: p.isFree,
				binary: p.binary,
				model: p.model ?? null,
				effort: p.effort ?? null,
			})),
			mode: sc.mode,
			pinnedPairId: sc.pinnedPairId,
		};
	}
	return out;
}
