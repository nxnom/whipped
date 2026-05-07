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
			cards: Record<string, { id: string; title: string; description: string; columnId: string; type?: string; priority?: string; dependsOn?: string[] }>;
		};

		const lines: string[] = [];
		for (const col of board.columns) {
			if (col.taskIds.length === 0) continue;
			lines.push(`## ${col.title}`);
			for (const id of col.taskIds) {
				const card = board.cards[id];
				if (!card) continue;
				const typeTag = card.type && card.type !== "task" ? ` [${card.type}]` : "";
				const priorityTag = card.priority ? ` [${card.priority}]` : "";
				const depsTag = card.dependsOn && card.dependsOn.length > 0 ? ` (depends on: ${card.dependsOn.join(", ")})` : "";
				lines.push(`- [${id}]${typeTag} ${card.title}${priorityTag}${depsTag}`);
				if (card.type === "story" && card.dependsOn && card.dependsOn.length > 0) {
					const met = card.dependsOn.filter(depId => {
						const dep = board.cards[depId];
						return dep?.columnId === "ready_for_review" || dep?.columnId === "done";
					});
					lines.push(`  Progress: ${met.length}/${card.dependsOn.length} subtasks complete`);
				}
			}
		}

		return { content: [{ type: "text", text: lines.join("\n") || "Board is empty." }] };
	},
);

server.registerTool(
	"kanban_create_story",
	{
		description: `Create a story ticket with its subtasks in one atomic operation.

Creates all subtasks first, then the story card that depends on them. The story triggers its orchestrator workflow automatically when all subtasks reach 'Ready for Review' or 'Done'.

**Intra-batch dependencies:** If subtask B should run after subtask A (both in this batch), give subtask A a \`tempId\` (e.g. "auth") and list that tempId in subtask B's \`dependsOn\`. The real card IDs are wired up automatically after creation.`,
		inputSchema: {
			title: z.string().describe("Story title — short description of the overall goal"),
			description: z.string().describe("Story description — what this story accomplishes as a whole, including acceptance criteria"),
			priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("Story priority"),
			workflowId: z.string().optional().describe("ID of the story orchestrator workflow. Omit to use the default story workflow."),
			baseRef: z.string().optional().describe("Base branch for all cards in this story. Omit to use the repo default branch."),
			subtasks: z.array(z.object({
				tempId: z.string().optional().describe("Short label to reference this subtask from other subtasks' dependsOn in this batch (e.g. 'auth', 'db-schema'). Not stored — only used for wiring up intra-batch deps."),
				title: z.string().describe("Subtask title"),
				description: z.string().describe("Subtask description with acceptance criteria"),
				priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("Subtask priority"),
				workflowId: z.string().optional().describe("Workflow ID for this subtask. Omit to use the default task workflow."),
				baseRef: z.string().optional().describe("Override base branch for this subtask only"),
				dependsOn: z.array(z.string()).optional().describe("Dependencies for this subtask. Use real card IDs for existing cards on the board, or tempId values to reference other subtasks in this same batch."),
			})).min(1).describe("Subtasks to create. At least one required. Each subtask gets type: 'subtask' and readyForDev: true automatically."),
		},
	},
	async ({ title, description, priority, workflowId, baseRef, subtasks }) => {
		// Pass 1: create all subtasks without intra-batch deps, build tempId → realId map
		const tempIdToRealId = new Map<string, string>();
		const createdSubtasks: Array<{ realId: string; title: string; rawDeps: string[] }> = [];

		for (const subtask of subtasks) {
			// Only pass existing board card IDs in this first pass — tempId refs aren't real yet
			const existingDeps = (subtask.dependsOn ?? []).filter(dep => !subtasks.some(s => s.tempId === dep));
			const card = await trpc<{ id: string; title: string }>("cards.create", {
				workspaceId,
				title: subtask.title,
				description: subtask.description,
				type: "subtask",
				priority: subtask.priority,
				readyForDev: true,
				baseRef: subtask.baseRef || baseRef || undefined,
				workflowId: subtask.workflowId || undefined,
				dependsOn: existingDeps.length > 0 ? existingDeps : undefined,
			});
			if (subtask.tempId) tempIdToRealId.set(subtask.tempId, card.id);
			createdSubtasks.push({ realId: card.id, title: subtask.title, rawDeps: subtask.dependsOn ?? [] });
		}

		// Pass 2: wire up any intra-batch tempId deps that are now resolvable
		for (const { realId, rawDeps } of createdSubtasks) {
			const batchDeps = rawDeps.filter(dep => tempIdToRealId.has(dep));
			if (batchDeps.length === 0) continue;
			const resolvedBatchDeps = batchDeps.map(dep => tempIdToRealId.get(dep)!);
			const existingDeps = rawDeps.filter(dep => !tempIdToRealId.has(dep));
			await trpc("cards.update", {
				workspaceId,
				cardId: realId,
				dependsOn: [...existingDeps, ...resolvedBatchDeps],
				revision: 0,
			});
		}

		// Create the story card depending on all subtasks
		const subtaskIds = createdSubtasks.map(s => s.realId);
		const storyCard = await trpc<{ id: string; title: string }>("cards.create", {
			workspaceId,
			title,
			description,
			type: "story",
			priority,
			baseRef: baseRef || undefined,
			workflowId: workflowId || undefined,
			dependsOn: subtaskIds,
		});

		const lines = [`Created story [${storyCard.id}] "${title}" with ${subtaskIds.length} subtask(s):`];
		for (const { realId, title: st } of createdSubtasks) lines.push(`  Subtask [${realId}] "${st}"`);
		lines.push(`The story will trigger its orchestrator workflow once all subtasks complete.`);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	},
);

server.registerTool(
	"kanban_create_card",
	{
		description: "Create a new task card on the Kanban board.",
		inputSchema: {
			title: z.string().describe("Short task title"),
			description: z.string().describe("Full task description including acceptance criteria"),
			type: z
				.enum(["task", "story", "subtask"])
				.optional()
				.describe("Card type — 'task' (default), 'story' (orchestrator ticket with subtasks), or 'subtask' (child of a story)"),
			priority: z
				.enum(["urgent", "high", "medium", "low"])
				.optional()
				.describe("Task priority — urgent cards are dispatched first in autonomous mode"),
			readyForDev: z
				.boolean()
				.optional()
				.describe("Mark the card as ready for the agent to pick up automatically. Defaults to false (true for story cards)."),
			columnId: z
				.enum(["todo", "blocked"])
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
	async ({ title, description, type, priority, readyForDev, columnId, dependsOn, workflowId }) => {
		const card = await trpc<{ id: string; title: string; columnId: string }>("cards.create", {
			workspaceId,
			title,
			description,
			type,
			priority,
			readyForDev,
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
				.enum(["todo", "in_progress", "reopened", "ready_for_review", "blocked", "done"])
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
			type: z.string().describe("Type of comment — use the slot id for custom agents (e.g. 'security_review')"),
			streamId: z.string().optional().describe("The terminal session stream ID for this agent run"),
			summary: z.string().describe("Your summary — 2-5 sentences describing what you did or found"),
			status: z.enum(["pass", "fail", "warning", "skipped"]).optional().describe("Result status of this review step"),
			issues: z.array(z.object({
				file: z.string().optional().describe("File path where the issue was found"),
				line: z.number().optional().describe("Line number of the issue"),
				severity: z.enum(["blocking", "warning", "info"]).describe("Severity level"),
				message: z.string().describe("Description of the issue"),
			})).optional().describe("Specific issues found during review"),
			attachments: z.array(z.object({
				type: z.literal("image").describe("Attachment type"),
				name: z.string().describe("Human-readable name for the attachment"),
				mimeType: z.string().describe("MIME type, e.g. image/png"),
				path: z.string().describe("Absolute file path to the attachment"),
			})).optional().describe("File attachments (e.g. screenshots)"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Additional metadata key-value pairs"),
		},
	},
	async ({ cardId, type, streamId, summary, status, issues, attachments, metadata }) => {
		// Process attachments: read each file and save to canonical attachment store
		let processedAttachments: Array<{ type: "image"; name: string; mimeType: string; path: string }> | undefined;
		if (attachments?.length) {
			const { readFile } = await import("node:fs/promises");
			const { saveAttachment: saveFn } = await import("../state/workspace-state.js");
			processedAttachments = [];
			for (const att of attachments) {
				try {
					const data = await readFile(att.path);
					const ext = att.path.split(".").pop() ?? "bin";
					const canonicalPath = await saveFn(data, ext, cardId);
					processedAttachments.push({ type: "image", name: att.name, mimeType: att.mimeType, path: canonicalPath });
				} catch {
					// Skip unreadable attachments
				}
			}
		}

		await trpc("cards.addReviewComment", {
			workspaceId,
			cardId,
			type,
			streamId,
			actor: { type: "ai", id: agentId },
			status,
			summary,
			issues,
			attachments: processedAttachments,
			metadata,
		});
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
	"kanban_stop_task",
	{
		description: "Stop an in-progress agent task. The session is marked 'stopped' (preserving history) so the card can be restarted later. Use this before moving a child card to todo when its parent was reopened.",
		inputSchema: {
			cardId: z.string().describe("The card ID of the in-progress task to stop"),
		},
	},
	async ({ cardId }) => {
		await trpc("cards.interruptTask", { workspaceId, cardId });
		return { content: [{ type: "text", text: `Task ${cardId} interrupted.` }] };
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
			id: string; name: string; isDefault: boolean; forStory?: boolean;
			slots: Array<{ id: string; type: string; name: string; agentBinary: string; order: number; enabled: boolean; prompt: string }>;
		}>>("workflows.list", { workspaceId });

		const lines: string[] = [];
		for (const wf of workflows) {
			const kind = wf.forStory ? " [story/orch workflow]" : " [task workflow]";
			lines.push(`## ${wf.name}${wf.isDefault ? " (default)" : ""}${kind} [id: ${wf.id}]`);
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
			forStory: z.boolean().optional().describe("True for story/orchestrator workflows (orch slots only). False for regular task workflows (dev/code_review/qa/custom slots)."),
			slots: z.array(z.object({
				id: z.string().describe("Unique slot ID within this workflow"),
				type: z.enum(["dev", "code_review", "qa", "custom", "orch"]).describe("Slot type. Use 'orch' for story orchestrator slots. Task workflows use dev/code_review/qa/custom."),
				name: z.string().describe("Display name for this slot"),
				agentBinary: z.enum(["claude", "codex"]).describe("Agent binary to use"),
				order: z.number().int().nonnegative().describe("Execution order (0 = first)"),
				enabled: z.boolean().describe("Whether this slot is active in the pipeline"),
				prompt: z.string().describe("System prompt / instructions for this agent slot. Empty string for default behavior."),
			})).describe("For task workflows: always include a dev slot (type: 'dev', order: 0). For story workflows: use only orch slots."),
		},
	},
	async ({ id, name, isDefault, forStory, slots }) => {
		const workflow = await trpc<{ id: string; name: string }>("workflows.upsert", {
			workspaceId,
			workflow: { id, name, isDefault: isDefault ?? false, forStory: forStory ?? false, slots },
		});
		return { content: [{ type: "text", text: `Workflow "${workflow.name}" [${workflow.id}] saved successfully.` }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
