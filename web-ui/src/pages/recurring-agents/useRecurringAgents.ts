import { useRead, useWrite } from "@/runtime/api-client";

// Wraps the recurring-agents endpoints. Spoosh auto-invalidates the list on every
// mutation; the page polls list.trigger() on an interval to keep run status /
// next-run fresh while the daemon works in the background (it can't push into the
// web cache).
export function useRecurringAgents(workspaceId: string) {
	const list = useRead((api) => api("recurring-agents").GET({ query: { workspaceId } }));

	const create = useWrite((api) => api("recurring-agents").POST());
	const update = useWrite((api) => api("recurring-agents/:id").PATCH());
	const remove = useWrite((api) => api("recurring-agents/:id").DELETE());
	const runNow = useWrite((api) => api("recurring-agents/:id/run").POST());
	const saveJournal = useWrite((api) => api("recurring-agents/:id/journal").POST());

	return { list, create, update, remove, runNow, saveJournal };
}
