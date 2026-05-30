import type { ProjectsLayout, RuntimeProject } from "@runtime-contract";
import type { FlatItem } from "./types";

export function genId() {
	return Math.random().toString(36).slice(2, 10);
}

/** Build the ordered flat array including folder headers. */
export function buildFlat(layout: ProjectsLayout, expandAll: boolean, isDragging = false): FlatItem[] {
	const flat: FlatItem[] = [];
	for (const item of layout.topLevel) {
		if (item.type === "folder") {
			flat.push({ kind: "folder-header", folderId: item.id });
			const expanded = expandAll || !layout.folders[item.id]?.collapsed;
			if (expanded) {
				const projectIds = layout.folders[item.id]?.projectIds ?? [];
				for (const wsId of projectIds) {
					flat.push({ kind: "project", workspaceId: wsId, folderId: item.id });
				}
				if (isDragging && projectIds.length === 0) {
					flat.push({ kind: "empty-folder-slot", folderId: item.id });
				}
			}
		} else {
			flat.push({ kind: "project", workspaceId: item.workspaceId, folderId: null });
		}
	}
	return flat;
}

/** Reconstruct ProjectsLayout from a re-ordered flat array. */
export function flatToLayout(flat: FlatItem[], existing: ProjectsLayout): ProjectsLayout {
	const topLevel: ProjectsLayout["topLevel"] = [];
	const folders: ProjectsLayout["folders"] = Object.fromEntries(
		Object.entries(existing.folders).map(([k, v]) => [k, { ...v, projectIds: [] }]),
	);
	const seen = new Set<string>();
	for (const item of flat) {
		if (item.kind === "empty-folder-slot") continue;
		if (item.kind === "folder-header") {
			if (!seen.has(item.folderId)) {
				seen.add(item.folderId);
				topLevel.push({ type: "folder", id: item.folderId });
			}
		} else if (item.folderId !== null) {
			folders[item.folderId]?.projectIds.push(item.workspaceId);
		} else {
			topLevel.push({ type: "project", workspaceId: item.workspaceId });
		}
	}
	return { ...existing, topLevel, folders };
}

/** What folder does a drop at `destIndex` land in (after source removal)?
 *
 * Primary: look at item AFTER destination (forward-look is unambiguous for "between folders").
 * Fallback at end-of-list: look at item BEFORE destination so you can still append inside a folder.
 */
export function folderAtDest(flat: FlatItem[], destIndex: number): string | null {
	const after = flat[destIndex];

	if (!after) {
		// End of list — inherit from previous item (lets users drop at end of a folder)
		const prev = flat[destIndex - 1];
		if (!prev || prev.kind === "folder-header") return null;
		if (prev.kind === "empty-folder-slot") return prev.folderId;
		return (prev as Extract<FlatItem, { kind: "project" }>).folderId;
	}

	if (after.kind === "folder-header") return after.folderId; // dropping on folder header → into that folder
	if (after.kind === "empty-folder-slot") return after.folderId;
	return (after as Extract<FlatItem, { kind: "project" }>).folderId;
}

/** Sync layout: add new projects, remove stale refs. */
export function syncLayout(layout: ProjectsLayout, projects: RuntimeProject[]): ProjectsLayout {
	const known = new Set(projects.map((p) => p.workspaceId));
	const topLevel = layout.topLevel.filter((i) => i.type === "folder" || known.has(i.workspaceId));
	const folders = Object.fromEntries(
		Object.entries(layout.folders).map(([id, f]) => [
			id,
			{ ...f, projectIds: f.projectIds.filter((id) => known.has(id)) },
		]),
	);
	const inLayout = new Set<string>();
	for (const i of topLevel) {
		if (i.type === "project") inLayout.add(i.workspaceId);
	}
	for (const f of Object.values(folders)) {
		for (const id of f.projectIds) inLayout.add(id);
	}
	const newItems = projects
		.filter((p) => !inLayout.has(p.workspaceId))
		.map((p) => ({ type: "project" as const, workspaceId: p.workspaceId }));
	return { ...layout, topLevel: [...topLevel, ...newItems], folders };
}
