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
