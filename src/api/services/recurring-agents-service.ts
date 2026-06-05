import type {
	RecurringAgent,
	RecurringAgentCreateRequest,
	RecurringAgentUpdateRequest,
} from "../../core/api-contract.js";
import {
	createRecurringAgent,
	deleteRecurringAgent,
	getRecurringAgent,
	listRecurringAgents,
	setRecurringAgentJournal,
	updateRecurringAgent,
} from "../../state/recurring-agents-store.js";

export function listRecurringAgentsEntry(workspaceId: string): RecurringAgent[] {
	return listRecurringAgents(workspaceId);
}

export function getRecurringAgentEntry(id: string): RecurringAgent | null {
	return getRecurringAgent(id);
}

export function createRecurringAgentEntry(workspaceId: string, req: RecurringAgentCreateRequest): RecurringAgent {
	return createRecurringAgent(workspaceId, req);
}

export function updateRecurringAgentEntry(req: RecurringAgentUpdateRequest): RecurringAgent | null {
	return updateRecurringAgent(req);
}

export function deleteRecurringAgentEntry(id: string): void {
	deleteRecurringAgent(id);
}

export function setRecurringAgentJournalEntry(id: string, journal: string): RecurringAgent | null {
	if (!getRecurringAgent(id)) return null;
	setRecurringAgentJournal(id, journal);
	return getRecurringAgent(id);
}
