import type { PlanBlock, PlanDocument } from "../../core/api-contract.js";
import { createCompanionPlan, listCompanionPlans } from "../../state/companion-plans-store.js";
import { getCompanionSession } from "../../state/companion-sessions-store.js";
import { NotFoundError } from "../errors/http-errors.js";

export const createCompanionPlanEntry = async (
	sessionId: string,
	workspaceId: string,
	blocks: PlanBlock[],
): Promise<PlanDocument> => {
	if (!getCompanionSession(sessionId)) throw NotFoundError("Companion session");
	return createCompanionPlan(sessionId, workspaceId, blocks);
};

export const listCompanionPlansEntry = async (sessionId: string): Promise<{ plans: PlanDocument[] }> => {
	if (!getCompanionSession(sessionId)) throw NotFoundError("Companion session");
	return { plans: listCompanionPlans(sessionId) };
};
