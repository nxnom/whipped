export const PRIORITY_OPTIONS = [
	{ value: "urgent", label: "Urgent", dot: "#ef4444", bg: "#ef444415", text: "#ef4444", border: "#ef444440" },
	{ value: "high", label: "High", dot: "#f97316", bg: "#f9731615", text: "#f97316", border: "#f9731640" },
	{ value: "medium", label: "Medium", dot: "#eab308", bg: "#eab30815", text: "#eab308", border: "#eab30840" },
	{ value: "low", label: "Low", dot: "#94a3b8", bg: "#94a3b820", text: "#94a3b8", border: "#94a3b850" },
] as const;

export const COLUMN_BADGE: Record<string, string> = {
	todo: "text-gray-400 bg-gray-700",
	in_progress: "text-blue-400 bg-blue-400/10",
	reopened: "text-orange-400 bg-orange-400/10",
	ready_for_review: "text-green-400 bg-green-400/10",
	blocked: "text-red-400 bg-red-400/10",
	done: "text-emerald-400 bg-emerald-400/10",
};

export const COLUMN_LABEL: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};
