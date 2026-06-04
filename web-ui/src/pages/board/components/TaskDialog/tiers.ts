import type { CardModelConfig, Workflow } from "@runtime-contract";
import type { CardModelConfigForm } from "@runtime-validation/card";

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
			defaultPairId: slot.defaultPairId,
			preferFree: slot.preferFree,
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
			defaultPairId: sc.defaultPairId,
			preferFree: sc.preferFree,
		};
	}
	return out;
}
