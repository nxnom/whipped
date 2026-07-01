import type { TunnelStatus } from "./types";

export const STATUS_STYLES: Record<TunnelStatus, { dot: string; text: string; label: string }> = {
	stopped: { dot: "#5f6672", text: "#5f6672", label: "Tunnel stopped" },
	starting: { dot: "#facc15", text: "#facc15", label: "Tunnel starting…" },
	running: { dot: "#4ade80", text: "#4ade80", label: "Tunnel running" },
	error: { dot: "#ff3b4d", text: "#ff3b4d", label: "Tunnel error" },
};
