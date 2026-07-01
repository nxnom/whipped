import type { PlanBlock, PlanDocument } from "../../core/api-contract.js";
import { createCompanionPlan, listCompanionPlans } from "../../state/companion-plans-store.js";

// Plan storage is keyed by an opaque sessionId — a real companion_sessions.id,
// or the assistant agent's synthetic per-workspace id — so it deliberately
// does not validate the session against companion_sessions here; the caller
// (route handler) already knows what kind of session it's dealing with.
export const createCompanionPlanEntry = async (
	sessionId: string,
	workspaceId: string,
	blocks: PlanBlock[],
): Promise<PlanDocument> => {
	return createCompanionPlan(sessionId, workspaceId, blocks);
};

export const listCompanionPlansEntry = async (sessionId: string): Promise<{ plans: PlanDocument[] }> => {
	return { plans: listCompanionPlans(sessionId) };
};
