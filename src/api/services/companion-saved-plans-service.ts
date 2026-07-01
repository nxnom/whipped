import type { CompanionSavedPlan, PlanBlock } from "../../core/api-contract.js";
import { deleteCompanionPlansForSession } from "../../state/companion-plans-store.js";
import {
	createCompanionSavedPlan,
	deleteCompanionSavedPlan,
	listCompanionSavedPlans,
	updateCompanionSavedPlan,
} from "../../state/companion-saved-plans-store.js";
import { getCompanionSession, setCompanionSessionSavedPlanId } from "../../state/companion-sessions-store.js";
import { NotFoundError } from "../errors/http-errors.js";

export async function listCompanionSavedPlansEntry(workspaceId: string): Promise<{ plans: CompanionSavedPlan[] }> {
	return { plans: listCompanionSavedPlans(workspaceId) };
}

export async function deleteCompanionSavedPlanEntry(id: string): Promise<void> {
	deleteCompanionSavedPlan(id);
}

export async function clearCompanionPlansEntry(sessionId: string): Promise<void> {
	if (!getCompanionSession(sessionId)) throw NotFoundError("Companion session");
	deleteCompanionPlansForSession(sessionId);
}

// Upserts by the session's linked saved plan: a session that already saved once
// (or resumed from a saved plan) updates that same row on every subsequent save,
// so a saved plan tracks progress instead of accumulating duplicates. Falls back
// to creating a new one if the linked row was deleted out from under the session.
export async function saveCompanionPlanEntry(
	sessionId: string,
	workspaceId: string,
	title: string,
	blocks: PlanBlock[],
): Promise<CompanionSavedPlan> {
	const session = getCompanionSession(sessionId);
	if (!session) throw NotFoundError("Companion session");

	if (session.savedPlanId) {
		const updated = updateCompanionSavedPlan(session.savedPlanId, { title, blocks });
		if (updated) return updated;
	}

	const created = createCompanionSavedPlan(workspaceId, { title, blocks, sourceSessionId: sessionId });
	setCompanionSessionSavedPlanId(sessionId, created.id);
	return created;
}
