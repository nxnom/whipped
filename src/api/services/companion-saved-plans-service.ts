import type { CompanionSavedPlan, PlanBlock } from "../../core/api-contract.js";
import { deleteCompanionPlansForSession } from "../../state/companion-plans-store.js";
import {
	createCompanionSavedPlan,
	deleteCompanionSavedPlan,
	findCompanionSavedPlanBySourceSession,
	listCompanionSavedPlans,
	updateCompanionSavedPlan,
} from "../../state/companion-saved-plans-store.js";
import { getCompanionSession, setCompanionSessionSavedPlanId } from "../../state/companion-sessions-store.js";

export async function listCompanionSavedPlansEntry(workspaceId: string): Promise<{ plans: CompanionSavedPlan[] }> {
	return { plans: listCompanionSavedPlans(workspaceId) };
}

export async function deleteCompanionSavedPlanEntry(id: string): Promise<void> {
	deleteCompanionSavedPlan(id);
}

export async function clearCompanionPlansEntry(sessionId: string): Promise<void> {
	deleteCompanionPlansForSession(sessionId);
}

// Upserts the plan this sessionId last saved, so repeated saves track progress
// instead of accumulating duplicates. Two ways to find "the last one":
// - A real companion session tracks its link on companion_sessions.saved_plan_id
//   (needed because a *resumed* session's own id differs from the plan's
//   source_session_id — the link is the only way to find it).
// - Any other sessionId (e.g. the assistant agent's synthetic per-workspace id,
//   which has no companion_sessions row to store a link on) falls back to
//   matching by source_session_id directly, since that id never changes.
export async function saveCompanionPlanEntry(
	sessionId: string,
	workspaceId: string,
	title: string,
	blocks: PlanBlock[],
): Promise<CompanionSavedPlan> {
	const session = getCompanionSession(sessionId);

	if (session) {
		if (session.savedPlanId) {
			const updated = updateCompanionSavedPlan(session.savedPlanId, { title, blocks });
			if (updated) return updated;
		}
		const created = createCompanionSavedPlan(workspaceId, { title, blocks, sourceSessionId: sessionId });
		setCompanionSessionSavedPlanId(sessionId, created.id);
		return created;
	}

	const existing = findCompanionSavedPlanBySourceSession(sessionId);
	if (existing) {
		const updated = updateCompanionSavedPlan(existing.id, { title, blocks });
		if (updated) return updated;
	}
	return createCompanionSavedPlan(workspaceId, { title, blocks, sourceSessionId: sessionId });
}
