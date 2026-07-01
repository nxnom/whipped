import { useRead, useWrite } from "@/runtime/api-client";

export function useCompanionSavedPlans(workspaceId: string) {
	const list = useRead((api) => api("companion-saved-plans").GET({ query: { workspaceId } }));
	const remove = useWrite((api) => api("companion-saved-plans/:id").DELETE());

	return { list, remove };
}
