import type { RuntimeJiraConfig, RuntimeJiraTicket } from "../core/api-contract.js";

export function createJiraClient(config: RuntimeJiraConfig) {
	const baseUrl = `https://${config.host}/rest/api/3`;
	const authHeader = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString("base64")}`;

	async function request<T>(path: string): Promise<T> {
		const response = await fetch(`${baseUrl}${path}`, {
			headers: { Authorization: authHeader, "Content-Type": "application/json" },
		});
		if (!response.ok) {
			throw new Error(`Jira API error ${response.status}: ${await response.text()}`);
		}
		return response.json() as Promise<T>;
	}

	function extractTextFromADF(node: any): string {
		if (!node) return "";
		if (node.type === "text") return node.text ?? "";
		if (node.content) {
			return (node.content as any[]).map(extractTextFromADF).join(" ");
		}
		return "";
	}

	return {
		async fetchProjectTickets(): Promise<RuntimeJiraTicket[]> {
			const jql = `project = ${config.projectKey} AND statusCategory != Done ORDER BY created DESC`;
			const data = await request<{ issues: any[] }>(
				`/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,status,comment`,
			);

			return data.issues.map((issue: any) => {
				const fields = issue.fields;
				const description = fields.description ? extractTextFromADF(fields.description) : "";

				const comments = (fields.comment?.comments ?? []).map((c: any) => ({
					author: c.author?.displayName ?? "Unknown",
					body: extractTextFromADF(c.body),
				}));

				return {
					key: issue.key as string,
					summary: fields.summary as string,
					description,
					url: `https://${config.host}/browse/${issue.key}`,
					status: fields.status?.name ?? "Unknown",
					comments,
				};
			});
		},

		async fetchTicket(key: string): Promise<RuntimeJiraTicket> {
			const issue = await request<any>(`/issue/${key}?fields=summary,description,status,comment`);
			const fields = issue.fields;
			const description = fields.description ? extractTextFromADF(fields.description) : "";
			const comments = (fields.comment?.comments ?? []).map((c: any) => ({
				author: c.author?.displayName ?? "Unknown",
				body: extractTextFromADF(c.body),
			}));

			return {
				key: issue.key as string,
				summary: fields.summary as string,
				description,
				url: `https://${config.host}/browse/${issue.key}`,
				status: fields.status?.name ?? "Unknown",
				comments,
			};
		},
	};
}

export type JiraClient = ReturnType<typeof createJiraClient>;
