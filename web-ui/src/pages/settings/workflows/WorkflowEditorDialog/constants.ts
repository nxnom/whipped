type SlotType = "code_review" | "qa" | "custom" | "orch";

export function slotDefaults(type: SlotType): { id: string; name: string; enabled: boolean } {
	const defaults: Record<SlotType, { id: string; name: string; enabled: boolean }> = {
		code_review: { id: "code_review", name: "Code Review", enabled: true },
		qa: { id: "qa", name: "QA", enabled: false },
		custom: { id: `slot_custom_${Date.now()}`, name: "Custom Agent", enabled: true },
		orch: { id: `slot_orch_${Date.now()}`, name: "Orch Agent", enabled: true },
	};
	return defaults[type];
}
