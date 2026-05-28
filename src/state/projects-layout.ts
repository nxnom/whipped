import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LAYOUT_PATH = join(homedir(), ".whipped", "projects-layout.json");

export interface ProjectFolder {
	id: string;
	name: string;
	collapsed: boolean;
	projectIds: string[];
}

export type TopLevelItem = { type: "folder"; id: string } | { type: "project"; workspaceId: string };

export interface ProjectsLayout {
	version: 1;
	topLevel: TopLevelItem[];
	folders: Record<string, ProjectFolder>;
}

const EMPTY: ProjectsLayout = { version: 1, topLevel: [], folders: {} };

export function loadProjectsLayout(): ProjectsLayout {
	if (!existsSync(LAYOUT_PATH)) return structuredClone(EMPTY);
	try {
		return JSON.parse(readFileSync(LAYOUT_PATH, "utf-8")) as ProjectsLayout;
	} catch {
		return structuredClone(EMPTY);
	}
}

export function saveProjectsLayout(layout: ProjectsLayout): void {
	writeFileSync(LAYOUT_PATH, JSON.stringify(layout, null, 2), "utf-8");
}
