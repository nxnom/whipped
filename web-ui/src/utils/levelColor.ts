import type { TierLevel } from "@runtime-contract";

// Cheap/low-capability → cool, expensive/high-capability → warm.
export const LEVEL_COLOR: Record<TierLevel, string> = {
	minimal: "#6b7280",
	low: "#22c55e",
	medium: "#eab308",
	high: "#f59e0b",
	max: "#ef4444",
};
