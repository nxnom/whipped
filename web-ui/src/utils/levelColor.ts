import type { TierLevel } from "@runtime-contract";

// Cheap/low-capability → cool, expensive/high-capability → warm.
export const LEVEL_COLOR: Record<TierLevel, string> = {
	minimal: "#5f6672",
	low: "#22c55e",
	medium: "#eab308",
	high: "#f97316",
	max: "#ff3b4d",
};
