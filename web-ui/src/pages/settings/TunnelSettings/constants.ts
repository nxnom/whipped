import type { TunnelStatus } from "./types";

export const STATUS_STYLES: Record<TunnelStatus, { dot: string; text: string; label: string }> = {
	stopped: { dot: "#60607a", text: "#60607a", label: "Tunnel stopped" },
	starting: { dot: "#facc15", text: "#facc15", label: "Tunnel starting…" },
	running: { dot: "#4ade80", text: "#4ade80", label: "Tunnel running" },
	error: { dot: "#ef4444", text: "#ef4444", label: "Tunnel error" },
};
