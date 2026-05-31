import type { MemorySourceType } from "../../core/api-contract.js";
import {
	approveMemory,
	type CreateMemoryInput,
	createMemory,
	deleteMemory,
	getMemory,
	getWorkspaceTags,
	type ListMemoriesFilter,
	listMemories,
	listMemoriesForCard,
	listTags,
	proposeMemory,
	proposeMemoryUpdate,
	searchMemories,
	setMemoryBindings,
	setMemoryTags,
	setWorkspaceTags,
	type UpdateMemoryInput,
	updateMemory,
} from "../../state/memory-store.js";

export const listMemoryEntries = async (filter: ListMemoriesFilter) => listMemories(filter);

export const searchMemoryEntries = async (query: string, workspaceId: string | null) =>
	searchMemories(query, workspaceId);

export const getMemoryEntry = async (id: string) => getMemory(id);

export const listMemoryEntriesForCard = async (cardId: string) => listMemoriesForCard(cardId);

export const proposeMemoryEntry = async (input: CreateMemoryInput) => proposeMemory(input);

export const proposeMemoryEntryUpdate = async (id: string, patch: UpdateMemoryInput, sourceType: MemorySourceType) =>
	proposeMemoryUpdate(id, patch, sourceType);

export const createMemoryEntry = async (input: CreateMemoryInput) => createMemory(input);

export const updateMemoryEntry = async (id: string, patch: UpdateMemoryInput) => updateMemory(id, patch);

export const approveMemoryEntry = async (id: string) => approveMemory(id);

export const removeMemoryEntry = async (id: string) => deleteMemory(id);

export const listTagsEntries = async () => listTags();

export const setMemoryTagsEntry = async (id: string, tags: string[]) => {
	if (!getMemory(id)) return null;
	setMemoryTags(id, tags);
	return getMemory(id);
};

export const setMemoryBindingsEntry = async (id: string, workspaceIds: string[]) => {
	if (!getMemory(id)) return null;
	setMemoryBindings(id, workspaceIds);
	return getMemory(id);
};

export const getWorkspaceTagsEntry = async (workspaceId: string) => getWorkspaceTags(workspaceId);

export const setWorkspaceTagsEntry = async (workspaceId: string, tags: string[]) => setWorkspaceTags(workspaceId, tags);
