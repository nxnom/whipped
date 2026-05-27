import type { ProjectsLayout, RuntimeProject } from "@runtime-contract";

export function firstSortedProjectId(layout: ProjectsLayout, projects: RuntimeProject[]): string | null {
	const known = new Set(projects.map((p) => p.workspaceId));
	for (const item of layout.topLevel) {
		if (item.type === "project" && known.has(item.workspaceId)) return item.workspaceId;
		if (item.type === "folder") {
			const folder = layout.folders[item.id];
			if (folder) {
				for (const id of folder.projectIds) {
					if (known.has(id)) return id;
				}
			}
		}
	}
	const inLayout = new Set<string>();
	for (const item of layout.topLevel) {
		if (item.type === "project") inLayout.add(item.workspaceId);
		else if (item.type === "folder") {
			for (const id of layout.folders[item.id]?.projectIds ?? []) inLayout.add(id);
		}
	}
	return projects.find((p) => !inLayout.has(p.workspaceId))?.workspaceId ?? null;
}
