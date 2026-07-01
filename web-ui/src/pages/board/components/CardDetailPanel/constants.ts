import type { RuntimeBoardCard } from "@runtime-contract";

export { AGENT_DISPLAY } from "@/pages/board/constants";

type TerminalSession = NonNullable<RuntimeBoardCard["terminalSessions"]>[number];

export function sessionStatus(session: TerminalSession): "running" | "failed" | "stopped" | "completed" {
	if (!session.endedAt) return "running";
	if (session.state === "failed" || session.state === "stopped") return session.state;
	return "completed";
}

export const COLUMN_LABELS: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

export const DEP_COL_BADGE: Record<string, string> = {
	todo: "text-[#5f6672] bg-[#161616]",
	in_progress: "text-[#ededed] bg-[#ffffff]/10",
	reopened: "text-[#f97316] bg-[#f97316]/10",
	ready_for_review: "text-[#eab308] bg-[#eab308]/10",
	blocked: "text-[#ff3b4d] bg-[#ff3b4d]/10",
	done: "text-[#22c55e] bg-[#22c55e]/10",
};

export const COLUMN_STATUS: Record<
	string,
	{ label: string; color: string; bg: string; border: string; dotColor: string; glow?: string }
> = {
	todo: {
		label: "Todo",
		color: "text-[#5f6672]",
		bg: "bg-[#5f6672]/10",
		border: "border-[#5f6672]/25",
		dotColor: "bg-[#5f6672]",
	},
	in_progress: {
		label: "In Progress",
		color: "text-[#ededed]",
		bg: "bg-[#ffffff]/10",
		border: "border-[#ffffff]/25",
		dotColor: "bg-[#ffffff]",
		glow: "#ffffff60",
	},
	reopened: {
		label: "Reopened",
		color: "text-[#f97316]",
		bg: "bg-[#f97316]/10",
		border: "border-[#f97316]/25",
		dotColor: "bg-[#f97316]",
	},
	ready_for_review: {
		label: "Ready for Review",
		color: "text-[#eab308]",
		bg: "bg-[#eab308]/10",
		border: "border-[#eab308]/25",
		dotColor: "bg-[#eab308]",
	},
	blocked: {
		label: "Blocked",
		color: "text-[#ff3b4d]",
		bg: "bg-[#ff3b4d]/10",
		border: "border-[#ff3b4d]/25",
		dotColor: "bg-[#ff3b4d]",
	},
	done: {
		label: "Done",
		color: "text-[#22c55e]",
		bg: "bg-[#22c55e]/10",
		border: "border-[#22c55e]/25",
		dotColor: "bg-[#22c55e]",
	},
};

export const PRIORITY_BADGE: Record<string, { color: string; bg: string; border: string; dotColor: string }> = {
	urgent: { color: "text-[#ff3b4d]", bg: "bg-[#ff3b4d]/10", border: "border-[#ff3b4d]/25", dotColor: "bg-[#ff3b4d]" },
	high: { color: "text-[#f97316]", bg: "bg-[#f97316]/10", border: "border-[#f97316]/25", dotColor: "bg-[#f97316]" },
	medium: {
		color: "text-[#eab308]",
		bg: "bg-[#eab308]/10",
		border: "border-[#eab308]/25",
		dotColor: "bg-[#eab308]",
	},
	low: { color: "text-[#5f6672]", bg: "bg-[#5f6672]/10", border: "border-[#5f6672]/25", dotColor: "bg-[#5f6672]" },
};

// Labels for terminal-session types that aren't workflow slots (e.g. worktree install).
export const SESSION_TYPE_LABELS: Record<string, string> = {
	install: "Install",
};

export function formatElapsed(sec: number): string {
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

export function slotDuration(startedAt: string | number, endedAt?: string | number | null): string {
	const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
	const sec = Math.floor((endMs - new Date(startedAt).getTime()) / 1000);
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}
