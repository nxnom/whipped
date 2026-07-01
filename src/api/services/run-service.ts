import { getCompanionSession } from "../../state/companion-sessions-store.js";
import { loadBoard, loadProjectConfig } from "../../state/workspace-state.js";

// Resolves the configured start command for a workspace, throwing when none is set.
export const resolveStartCommand = async (workspaceId: string): Promise<string> => {
	const projectConfig = await loadProjectConfig(workspaceId);
	const command = projectConfig.startCommand?.trim();
	if (!command) return "";
	return command;
};

// Resolves the working directory for a card's run: its worktree if present,
// otherwise the workspace repo root. Returns null when the card is missing.
export const resolveCardCwd = async (workspaceId: string, cardId: string, repoPath: string): Promise<string | null> => {
	const board = await loadBoard(workspaceId);
	const card = board.cards[cardId];
	if (!card) return null;
	return card.worktreePath ?? repoPath;
};

// Resolves the working directory for a companion session's run: its worktree
// (or the main repo checkout, for a main-repo-mode session) once the agent has
// started. Returns null when the session is missing or hasn't started yet.
export const resolveCompanionSessionCwd = (sessionId: string): string | null => {
	const session = getCompanionSession(sessionId);
	return session?.worktreePath ?? null;
};
