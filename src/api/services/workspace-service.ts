import { spawnSync } from "node:child_process";
import {
	listWorkspaces,
	loadWorkspaceState,
	saveWorkspaceState,
	setAutonomousMode,
} from "../../state/workspace-state.js";
import type { RuntimeWorkspaceStateSaveRequest } from "../../core/api-contract.js";
import { NotFoundError } from "../errors/http-errors.js";

// Loads state for an explicitly requested workspace, resolving its repo path from
// the workspace index. Throws when the workspace is unknown.
export const loadStateForWorkspace = async (workspaceId: string) => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");
	return loadWorkspaceState(ws.workspaceId, ws.repoPath);
};

// Loads state for the active workspace context (already resolved repo path).
export const loadStateForContext = async (workspaceId: string, repoPath: string) =>
	loadWorkspaceState(workspaceId, repoPath);

export const saveState = async (workspaceId: string, request: RuntimeWorkspaceStateSaveRequest) =>
	saveWorkspaceState(workspaceId, request);

export const updateAutonomousMode = async (workspaceId: string, enabled: boolean) =>
	setAutonomousMode(workspaceId, enabled);

// Lists ignored + untracked top-level entries in the repo (deduped, sorted),
// filtering out anything nested under a subdirectory.
export const listRootFiles = (repoPath: string): { files: string[] } => {
	const ignored = spawnSync(
		"git",
		["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"],
		{ cwd: repoPath, encoding: "utf-8" },
	);
	const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd: repoPath,
		encoding: "utf-8",
	});
	const all = [...(ignored.stdout ?? "").split("\n"), ...(untracked.stdout ?? "").split("\n")]
		.map((f) => f.trim().replace(/\/$/, ""))
		.filter((f) => f && !f.includes("/"));
	return { files: [...new Set(all)].sort() };
};
