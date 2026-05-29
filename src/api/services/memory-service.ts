import type { MemorySourceType } from "../../core/api-contract.js";
import {
	approveMemory,
	createMemory,
	type CreateMemoryInput,
	deleteMemory,
	getMemory,
	listMemories,
	type ListMemoriesFilter,
	listMemoriesForCard,
	proposeMemory,
	proposeMemoryUpdate,
	searchMemories,
	updateMemory,
	type UpdateMemoryInput,
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
