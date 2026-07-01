// Canonical per-agent-binary display styling, shared by KanbanCard and CardDetailPanel.
export const AGENT_DISPLAY: Record<
	string,
	{ label: string; color: string; bg: string; border: string; dotColor: string }
> = {
	claude: {
		label: "Claude",
		color: "text-[#8b5cf6]",
		bg: "bg-[#8b5cf6]/10",
		border: "border-[#8b5cf6]/25",
		dotColor: "bg-[#8b5cf6]",
	},
	codex: {
		label: "Codex",
		color: "text-[#22c55e]",
		bg: "bg-[#22c55e]/10",
		border: "border-[#22c55e]/25",
		dotColor: "bg-[#22c55e]",
	},
	cursor: {
		label: "Cursor",
		color: "text-[#3b82f6]",
		bg: "bg-[#3b82f6]/10",
		border: "border-[#3b82f6]/25",
		dotColor: "bg-[#3b82f6]",
	},
	opencode: {
		label: "Opencode",
		color: "text-[#f97316]",
		bg: "bg-[#f97316]/10",
		border: "border-[#f97316]/25",
		dotColor: "bg-[#f97316]",
	},
	mimo: {
		label: "MiMo",
		color: "text-[#fb8147]",
		bg: "bg-[#fb8147]/10",
		border: "border-[#fb8147]/25",
		dotColor: "bg-[#fb8147]",
	},
};
