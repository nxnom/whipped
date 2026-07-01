export const PRIORITY_OPTIONS = [
	{ value: "urgent", label: "Urgent", dot: "#ff3b4d", bg: "#ff3b4d15", text: "#ff3b4d", border: "#ff3b4d40" },
	{ value: "high", label: "High", dot: "#f97316", bg: "#f9731615", text: "#f97316", border: "#f9731640" },
	{ value: "medium", label: "Medium", dot: "#eab308", bg: "#eab30815", text: "#eab308", border: "#eab30840" },
	{ value: "low", label: "Low", dot: "#5f6672", bg: "#5f667220", text: "#5f6672", border: "#5f667250" },
] as const;

export const COLUMN_BADGE: Record<string, string> = {
	todo: "text-[#5f6672] bg-[#161616]",
	in_progress: "text-[#ededed] bg-[#ffffff]/10",
	reopened: "text-[#f97316] bg-[#f97316]/10",
	ready_for_review: "text-[#eab308] bg-[#eab308]/10",
	blocked: "text-[#ff3b4d] bg-[#ff3b4d]/10",
	done: "text-[#22c55e] bg-[#22c55e]/10",
};

export const COLUMN_LABEL: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};
