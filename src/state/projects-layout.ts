import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "./db.js";

// Legacy JSON path — kept exported for the future one-time JSON→SQLite import.
// Live reads/writes now go through SQLite via projects_layout singleton row.
export const LAYOUT_PATH = join(homedir(), ".whipped", "projects-layout.json");

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
	db.prepare("UPDATE projects_layout SET layout_json = ?, updated_at = ? WHERE id = 1").run(
		JSON.stringify(layout),
		Date.now(),
	);
}
