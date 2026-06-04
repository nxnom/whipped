import type { RuntimeProjectConfig } from "../../core/api-contract.js";
import { loadProjectConfig, updateProjectConfig } from "../../state/workspace-state.js";

export const getProjectConfig = async (workspaceId: string): Promise<RuntimeProjectConfig> =>
	loadProjectConfig(workspaceId);

// Full-replace, but acquired through the lock so it serializes against any
// concurrent partial setters (workflows, gitInstructions, etc.).
export const saveProjectConfig = async (workspaceId: string, config: RuntimeProjectConfig): Promise<void> => {
	await updateProjectConfig(workspaceId, () => config);
};

export const setGitInstructions = async (workspaceId: string, instructions: string): Promise<{ cleared: boolean }> => {
	const trimmed = instructions.trim();
	await updateProjectConfig(workspaceId, (c) => ({ ...c, gitInstructions: trimmed || undefined }));
	return { cleared: !trimmed };
};

export const setSystemPrompt = async (workspaceId: string, prompt: string): Promise<{ cleared: boolean }> => {
	const trimmed = prompt.trim();
	await updateProjectConfig(workspaceId, (c) => ({ ...c, systemPrompt: trimmed || undefined }));
	return { cleared: !trimmed };
};
