import { getDb } from "./db.js";

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

function parseLayout(rawJson: string): ProjectsLayout {
	try {
		const parsed = JSON.parse(rawJson) as ProjectsLayout;
		if (parsed && parsed.version === 1 && Array.isArray(parsed.topLevel) && typeof parsed.folders === "object") {
			return parsed;
		}
	} catch {
		// fall through
	}
	return structuredClone(EMPTY);
}

export function loadProjectsLayout(): ProjectsLayout {
	const db = getDb();
	const row = db.prepare("SELECT layout_json FROM projects_layout WHERE id = 1").get() as
		| { layout_json: string }
		| undefined;
	if (!row) return structuredClone(EMPTY);
	return parseLayout(row.layout_json);
}

export function saveProjectsLayout(layout: ProjectsLayout): void {
	const db = getDb();
	// INSERT OR REPLACE so the save survives the singleton row going missing.
	db.prepare("INSERT OR REPLACE INTO projects_layout (id, layout_json, updated_at) VALUES (1, ?, ?)").run(
		JSON.stringify(layout),
		Date.now(),
	);
}
