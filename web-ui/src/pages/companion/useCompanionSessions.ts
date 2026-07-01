import { useRead, useWrite } from "@/runtime/api-client";

export function useCompanionSessions(workspaceId: string) {
	const list = useRead((api) => api("companion-sessions").GET({ query: { workspaceId } }));

	const create = useWrite((api) => api("companion-sessions").POST());
	const stop = useWrite((api) => api("companion-sessions/:id").DELETE());
	const discard = useWrite((api) => api("companion-sessions/:id/discard").POST());
	const commitAndMerge = useWrite((api) => api("companion-sessions/:id/commit-and-merge").POST());
	const commitAndPR = useWrite((api) => api("companion-sessions/:id/commit-and-pr").POST());

	return { list, create, stop, discard, commitAndMerge, commitAndPR };
}
