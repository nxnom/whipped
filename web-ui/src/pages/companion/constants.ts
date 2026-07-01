import type { CompanionSessionStatus } from "@runtime-contract";

export const STATUS_LABEL: Record<CompanionSessionStatus, string> = {
	installing: "Installing",
	running: "Running",
	stopped: "Stopped",
	merged: "Merged",
	discarded: "Discarded",
};

export const STATUS_DOT_CLASS: Record<CompanionSessionStatus, string> = {
	installing: "bg-amber-400 animate-pulse",
	running: "bg-emerald-400",
	stopped: "bg-[#3a3a45]",
	merged: "bg-[#7c6aff]",
	discarded: "bg-[#3a3a45]",
};
