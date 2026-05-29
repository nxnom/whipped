import { createJiraClient } from "../../jira/jira-client.js";
import { createCard, loadProjectConfig, listWorkspaces } from "../../state/workspace-state.js";
import { getDefaultBranch } from "../../worktree/worktree-manager.js";

export const fetchJiraTickets = async (workspaceId: string) => {
	const projectConfig = await loadProjectConfig(workspaceId);
	if (!projectConfig.jira) return null;
	return createJiraClient(projectConfig.jira).fetchProjectTickets();
};

export const importJiraTickets = async (workspaceId: string, ticketKeys: string[]) => {
	const projectConfig = await loadProjectConfig(workspaceId);
	if (!projectConfig.jira) return { error: "not_configured" as const };

	const workspaces = await listWorkspaces();
	const ws = workspaces.find((w) => w.workspaceId === workspaceId);
	if (!ws) return { error: "workspace_not_found" as const };

	const client = createJiraClient(projectConfig.jira);
	const created = [];
	for (const key of ticketKeys) {
		const ticket = await client.fetchTicket(key);
		const description = [
			ticket.description,
			ticket.comments.length > 0
				? `\n\n## Comments\n${ticket.comments.map((c) => `**${c.author}:** ${c.body}`).join("\n\n")}`
				: "",
		].join("");
		const baseRef = getDefaultBranch(ws.repoPath);
		const card = await createCard(
			workspaceId,
			{
				description: `[${ticket.key}] ${ticket.summary}\n\n${description}`.trim(),
				jiraKey: ticket.key,
				jiraUrl: ticket.url,
			},
			baseRef,
		);
		created.push(card);
	}
	return { created };
};
