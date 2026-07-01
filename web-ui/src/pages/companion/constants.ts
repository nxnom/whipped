import type { CompanionSessionStatus } from "@runtime-contract";

export const STATUS_LABEL: Record<CompanionSessionStatus, string> = {
	installing: "Installing",
	running: "Running",
	stopped: "Stopped",
	merged: "Merged",
	discarded: "Discarded",
};

export const STATUS_DOT_CLASS: Record<CompanionSessionStatus, string> = {
	installing: "bg-[#eab308] animate-pulse",
	running: "bg-[#22c55e]",
	stopped: "bg-[#3a3a3a]",
	merged: "bg-[#ffffff]",
	discarded: "bg-[#3a3a3a]",
};
