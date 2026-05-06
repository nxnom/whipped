#!/usr/bin/env node
/**
 * Stdio MCP server exposing Kanban board operations to the home agent.
 * Launched by Claude Code as a subprocess; communicates via stdin/stdout.
 *
 * Args: <serverUrl> <workspaceId>
 *   e.g. node mcp-server.js http://127.0.0.1:3000 abc123
 *
 * Falls back to env vars KANBOM_SERVER_URL / KANBOM_WORKSPACE_ID.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const serverUrl = process.argv[2] ?? process.env.KANBOM_SERVER_URL ?? "http://127.0.0.1:3000";
const workspaceId = process.argv[3] ?? process.env.KANBOM_WORKSPACE_ID ?? "";
const agentId = process.argv[4] ?? "claude";

async function trpc<T>(procedure: string, input: unknown): Promise<T> {
	const res = await fetch(`${serverUrl}/api/trpc/${procedure}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`tRPC ${procedure} failed: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as { result?: { data?: T } };
	return body.result?.data as T;
}

async function trpcQuery<T>(procedure: string, input: unknown): Promise<T> {
	const encoded = encodeURIComponent(JSON.stringify(input));
	const res = await fetch(`${serverUrl}/api/trpc/${procedure}?input=${encoded}`, {
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`tRPC ${procedure} failed: ${res.status} ${await res.text()}`);
	const body = (await res.json()) as { result?: { data?: T } };
	const data = body.result?.data;
	if (data == null) throw new Error(`tRPC ${procedure} returned empty response`);
	return data;
}

const server = new McpServer({ name: "kanbom", version: "1.0.0" });

server.registerTool(
	"kanban_get_board",
	{
		description: "Get the current Kanban board state including all cards and their columns.",
		inputSchema: {},
	},
	async () => {
		const state = await trpcQuery<{ board: { columns: unknown[]; cards: unknown } }>(
			"workspace.state",
			{ workspaceId },
		);
		const board = state.board as {
			columns: Array<{ id: string; title: string; taskIds: string[] }>;
			cards: Record<string, { id: string; title: string; description: string; columnId: string; priority?: string; dependsOn?: string[] }>;
		};

		const lines: string[] = [];
		for (const col of board.columns) {
			if (col.taskIds.length === 0) continue;
			lines.push(`## ${col.title}`);
			for (const id of col.taskIds) {
				const card = board.cards[id];
				if (!card) continue;
				const priorityTag = card.priority ? ` [${card.priority}]` : "";
				const depsTag = card.dependsOn && card.dependsOn.length > 0 ? ` (depends on: ${card.dependsOn.join(", ")})` : "";
				lines.push(`- [${id}] ${card.title}${priorityTag}${depsTag}`);
			}
		}

		return { content: [{ type: "text", text: lines.join("\n") || "Board is empty." }] };
	},
);

server.registerTool(
	"kanban_create_card",
	{
		description: "Create a new task card on the Kanban board.",
		inputSchema: {
			title: z.string().describe("Short task title"),
			description: z.string().describe("Full task description including acceptance criteria"),
			priority: z
				.enum(["urgent", "high", "medium", "low"])
				.optional()
				.describe("Task priority — urgent cards are dispatched first in autonomous mode"),
			columnId: z
				.enum(["todo", "ready_for_dev", "blocked"])
				.optional()
				.describe("Starting column — defaults to 'todo'"),
			dependsOn: z
				.array(z.string())
				.optional()
				.describe("Card IDs this task depends on — it cannot start until all deps are in ready_for_review or done"),
			workflowId: z
				.string()
				.optional()
				.describe("ID of the workflow to use for this task. Omit to use the default."),
		},
	},
	async ({ title, description, priority, columnId, dependsOn, workflowId }) => {
		const card = await trpc<{ id: string; title: string; columnId: string }>("cards.create", {
			workspaceId,
			title,
			description,
			priority,
			dependsOn,
			columnId: columnId ?? "todo",
			workflowId,
		});
		return {
			content: [{ type: "text", text: `Created card [${card.id}] "${card.title}" in ${card.columnId}.` }],
		};
	},
);

server.registerTool(
	"kanban_move_card",
	{
		description: "Move a card to a different column.",
		inputSchema: {
			cardId: z.string().describe("The card ID (from kanban_get_board)"),
			targetColumnId: z
				.enum(["todo", "ready_for_dev", "in_progress", "in_review", "reopened", "ready_for_review", "blocked", "done"])
				.describe("Destination column"),
		},
	},
	async ({ cardId, targetColumnId }) => {
		await trpc("cards.move", { workspaceId, cardId, targetColumnId, revision: 0 });
		return { content: [{ type: "text", text: `Moved card ${cardId} to ${targetColumnId}.` }] };
	},
);

server.registerTool(
	"kanban_update_card",
	{
		description: "Update a card's title, description, priority, or dependencies.",
		inputSchema: {
			cardId: z.string().describe("The card ID"),
			title: z.string().optional().describe("New title"),
			description: z.string().optional().describe("New description"),
			priority: z
				.enum(["urgent", "high", "medium", "low"])
				.optional()
				.describe("New priority level"),
			dependsOn: z
				.array(z.string())
				.optional()
				.describe("Full replacement list of card IDs this task depends on (pass [] to clear)"),
		},
	},
	async ({ cardId, title, description, priority, dependsOn }) => {
		await trpc("cards.update", { workspaceId, cardId, title, description, priority, dependsOn, revision: 0 });
		return { content: [{ type: "text", text: `Updated card ${cardId}.` }] };
	},
);

server.registerTool(
	"kanban_add_comment",
	{
		description:
			"Record your analysis, findings, or summary as a comment on a Kanban card. Call this when you have finished your work so your output is cleanly stored.",
		inputSchema: {
			cardId: z.string().describe("The card ID you are reviewing"),
			content: z.string().describe("Your full comment — analysis, findings, summary, etc."),
			type: z.string().describe("Type of comment — use the slot id for custom agents (e.g. 'security_review')"),
			passed: z.boolean().optional().describe("For code_review and qa: whether the check passed (true) or failed (false)"),
		},
	},
	async ({ cardId, content, type, passed }) => {
		await trpc("cards.addReviewComment", { workspaceId, cardId, content, type, agent: agentId, passed });
		return { content: [{ type: "text", text: `Comment recorded on card ${cardId}.` }] };
	},
);

server.registerTool(
	"kanban_delete_card",
	{
		description: "Delete a card from the board permanently.",
		inputSchema: {
			cardId: z.string().describe("The card ID to delete"),
		},
	},
	async ({ cardId }) => {
		await trpc("cards.delete", { workspaceId, cardId });
		return { content: [{ type: "text", text: `Deleted card ${cardId}.` }] };
	},
);

server.registerTool(
	"kanban_get_workflows",
	{
		description: "Get all workflows configured for this project, including their agent slots, models, and prompts.",
		inputSchema: {},
	},
	async () => {
		const workflows = await trpcQuery<Array<{
			id: string; name: string; isDefault: boolean;
			slots: Array<{ id: string; type: string; name: string; agentBinary: string; order: number; enabled: boolean; prompt: string }>;
		}>>("workflows.list", { workspaceId });

		const lines: string[] = [];
		for (const wf of workflows) {
			lines.push(`## ${wf.name}${wf.isDefault ? " (default)" : ""} [id: ${wf.id}]`);
			const sorted = [...wf.slots].sort((a, b) => a.order - b.order);
			for (const slot of sorted) {
				const status = slot.enabled ? "enabled" : "disabled";
				const prompt = slot.prompt ? `\n    prompt: ${slot.prompt.slice(0, 120)}${slot.prompt.length > 120 ? "..." : ""}` : "";
				lines.push(`  - [${slot.id}] ${slot.name} (${slot.type}, ${slot.agentBinary}, ${status})${prompt}`);
			}
		}
		return { content: [{ type: "text", text: lines.join("\n") || "No workflows configured." }] };
	},
);

server.registerTool(
	"kanban_upsert_workflow",
	{
		description: "Create or update a workflow. Pass the full workflow object including all slots. If a workflow with the given id already exists it will be replaced; otherwise a new one is created.",
		inputSchema: {
			id: z.string().describe("Unique workflow ID. Use a short slug like 'wf_security' for new workflows."),
			name: z.string().describe("Human-readable workflow name, e.g. 'Security Review'"),
			isDefault: z.boolean().optional().describe("Whether this is the default workflow (only one can be default)"),
			slots: z.array(z.object({
				id: z.string().describe("Unique slot ID within this workflow"),
				type: z.enum(["dev", "code_review", "qa", "custom"]).describe("Slot type"),
				name: z.string().describe("Display name for this slot"),
				agentBinary: z.enum(["claude", "codex"]).describe("Agent binary to use"),
				order: z.number().int().nonnegative().describe("Execution order (0 = first)"),
				enabled: z.boolean().describe("Whether this slot is active in the pipeline"),
				prompt: z.string().describe("System prompt / instructions for this agent slot. Empty string for default behavior."),
			})).describe("Ordered list of agent slots in this workflow. Always include a dev slot (type: 'dev', order: 0)."),
		},
	},
	async ({ id, name, isDefault, slots }) => {
		const workflow = await trpc<{ id: string; name: string }>("workflows.upsert", {
			workspaceId,
			workflow: { id, name, isDefault: isDefault ?? false, slots },
		});
		return { content: [{ type: "text", text: `Workflow "${workflow.name}" [${workflow.id}] saved successfully.` }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
