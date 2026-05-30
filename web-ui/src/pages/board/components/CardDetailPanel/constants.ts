export const COLUMN_LABELS: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

export const DEP_COL_BADGE: Record<string, string> = {
	todo: "text-gray-400 bg-gray-700",
	in_progress: "text-blue-400 bg-blue-400/10",
	reopened: "text-orange-400 bg-orange-400/10",
	ready_for_review: "text-green-400 bg-green-400/10",
	blocked: "text-red-400 bg-red-400/10",
	done: "text-emerald-400 bg-emerald-400/10",
};

export const COLUMN_STATUS: Record<
	string,
	{ label: string; color: string; bg: string; border: string; dotColor: string; glow?: string }
> = {
	todo: {
		label: "Todo",
		color: "text-gray-400",
		bg: "bg-gray-400/10",
		border: "border-gray-400/25",
		dotColor: "bg-gray-400",
	},
	in_progress: {
		label: "In Progress",
		color: "text-[#3b82f6]",
		bg: "bg-[#3b82f6]/10",
		border: "border-[#3b82f6]/25",
		dotColor: "bg-[#3b82f6]",
		glow: "#3b82f660",
	},
	reopened: {
		label: "Reopened",
		color: "text-orange-400",
		bg: "bg-orange-400/10",
		border: "border-orange-400/25",
		dotColor: "bg-orange-400",
	},
	ready_for_review: {
		label: "Ready for Review",
		color: "text-yellow-400",
		bg: "bg-yellow-400/10",
		border: "border-yellow-400/25",
		dotColor: "bg-yellow-400",
	},
	blocked: {
		label: "Blocked",
		color: "text-red-400",
		bg: "bg-red-400/10",
		border: "border-red-400/25",
		dotColor: "bg-red-400",
	},
	done: {
		label: "Done",
		color: "text-emerald-400",
		bg: "bg-emerald-400/10",
		border: "border-emerald-400/25",
		dotColor: "bg-emerald-400",
	},
};

export const PRIORITY_BADGE: Record<string, { color: string; bg: string; border: string; dotColor: string }> = {
	urgent: { color: "text-[#ef4444]", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/25", dotColor: "bg-[#ef4444]" },
	high: { color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/25", dotColor: "bg-orange-400" },
	medium: {
		color: "text-yellow-400",
		bg: "bg-yellow-400/10",
		border: "border-yellow-400/25",
		dotColor: "bg-yellow-400",
	},
	low: { color: "text-slate-400", bg: "bg-slate-400/10", border: "border-slate-400/25", dotColor: "bg-slate-400" },
};

export const AGENT_DISPLAY: Record<
	string,
	{ label: string; color: string; bg: string; border: string; dotColor: string }
> = {
	claude: {
		label: "Claude",
		color: "text-[#7c6aff]",
		bg: "bg-[#7c6aff]/10",
		border: "border-[#7c6aff]/25",
		dotColor: "bg-[#7c6aff]",
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
};

export function formatElapsed(sec: number): string {
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

export function slotDuration(startedAt: string | number, endedAt?: string | number | null): string {
	const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
	const sec = Math.floor((endMs - new Date(startedAt).getTime()) / 1000);
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}
