import type { PromptValue } from "@runtime-contract";

export function promptInlineText(prompt: PromptValue | undefined): string {
	return prompt?.source === "inline" ? prompt.text : "";
}

export function slotTypeColor(type: string): string {
	if (type === "dev") return "#3b82f6";
	if (type === "plan") return "#eab308";
	if (type === "review") return "#22c55e";
	if (type === "orch") return "#7c6aff";
	return "#8888a0";
}
