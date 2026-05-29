import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Workflow } from "../../core/api-contract.js";
import { listWorkspaces, loadProjectConfig, updateProjectConfig } from "../../state/workspace-state.js";
import { BadRequestError, NotFoundError } from "../errors/http-errors.js";

// Resolves a user-supplied prompt-file path to an absolute path.
// - Absolute paths are used as-is (the user explicitly chose them via the file
//   picker or typed them; this is a single-user local/self-hosted daemon).
// - Relative paths resolve against the workspace repo root and must not use
//   parent-traversal to escape it.
export const resolvePromptPath = async (workspaceId: string, requestedPath: string): Promise<string> => {
	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) throw NotFoundError("Workspace");

	if (isAbsolute(requestedPath)) return requestedPath;

	if (requestedPath.split("/").includes("..")) {
		throw BadRequestError("Relative path must not use '..'");
	}
	return resolve(ws.repoPath, requestedPath);
};

export const listWorkflows = async (workspaceId: string) => {
	const config = await loadProjectConfig(workspaceId);
	return config.workflows;
};

export const upsertWorkflow = async (workspaceId: string, workflow: Workflow) => {
	await updateProjectConfig(workspaceId, (config) => {
		const idx = config.workflows.findIndex((w) => w.id === workflow.id);
		const workflows = [...config.workflows];
		if (idx >= 0) {
			workflows[idx] = workflow;
		} else {
			workflows.push(workflow);
		}
		return { ...config, workflows };
	});
	return workflow;
};

export const deleteWorkflow = async (workspaceId: string, workflowId: string) => {
	await updateProjectConfig(workspaceId, (config) => ({
		...config,
		workflows: config.workflows.filter((w) => w.id !== workflowId),
	}));
	return { ok: true };
};

export const writePromptFile = async (workspaceId: string, path: string, content: string) => {
	const targetPath = await resolvePromptPath(workspaceId, path);
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, content, "utf-8");
	return { path };
};

export const readPromptFile = async (workspaceId: string, path: string) => {
	const targetPath = await resolvePromptPath(workspaceId, path);
	if (!existsSync(targetPath)) return { content: "", exists: false };
	const content = await readFile(targetPath, "utf-8");
	return { content, exists: true };
};
