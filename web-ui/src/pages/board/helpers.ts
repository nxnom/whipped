import type { RuntimeBoardCard } from "@runtime-contract";

// A card counts as "running" when it has a terminal session that hasn't ended yet.
export function isCardRunning(card: RuntimeBoardCard): boolean {
	return card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
}
