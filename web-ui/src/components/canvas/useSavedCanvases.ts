import { useRead, useWrite } from "@/runtime/api-client";

export function useSavedCanvases(workspaceId: string) {
	const list = useRead((api) => api("companion-saved-canvases").GET({ query: { workspaceId } }));
	const remove = useWrite((api) => api("companion-saved-canvases/:id").DELETE());

	return { list, remove };
}
