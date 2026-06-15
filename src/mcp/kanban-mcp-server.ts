/**
 * Stdio MCP server exposing Kanban board operations to the assistant agent.
 * Launched by Claude Code as a subprocess; communicates via stdin/stdout.
 *
 * Args: <serverUrl> <workspaceId>
 *   e.g. node mcp-server.js http://127.0.0.1:3000 abc123
 *
 * Falls back to env vars WHIPPED_SERVER_URL / WHIPPED_WORKSPACE_ID.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ASSISTANT_AGENT_PREFIX, DEFAULT_GIT_INSTRUCTIONS } from "../core/api-contract.js";

const serverUrl = process.argv[2] ?? process.env.WHIPPED_SERVER_URL ?? "http://127.0.0.1:3000";
const workspaceId = process.argv[3] ?? process.env.WHIPPED_WORKSPACE_ID ?? "";
const agentId = process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : "claude";

// Role gates which tools this server exposes (position-independent named flags):
//   assistant — may create/list/update/delete recurring agents.
//   recurring — a recurring agent; may write its own journal (id below) but cannot
//               manage recurring agents (no self-creation).
// Anything else (task/review/unset) gets only the base board tools.
function namedArg(flag: string): string | undefined {
	const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
	return hit ? hit.slice(flag.length + 1) : undefined;
}
const mcpRole = namedArg("--role") ?? "task";
const recurringAgentId = namedArg("--recurring-agent-id") ?? "";

// Authenticates this machinery process against the daemon's auth gate.
const apiToken = process.env.WHIPPED_API_TOKEN ?? "";
const authHeaders: Record<string, string> = apiToken ? { "x-whipped-token": apiToken } : {};

// Maps each logical procedure to its Hono REST route. The assistant agent runs as a
// separate process and calls the server over HTTP; responses are unwrapped
// (Hono returns the value directly, unlike tRPC's { result: { data } }).
type RestRoute = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: (input: Record<string, unknown>) => string };

const ROUTES: Record<string, RestRoute> = {
	"workspace.state": { method: "GET", path: () => "workspace/state" },
	"workflows.list": { method: "GET", path: () => "workflows" },
	"projectConfig.get": { method: "GET", path: () => "project-config" },
	"memory.search": { method: "GET", path: () => "memory/search" },
	"memory.get": { method: "GET", path: (i) => `memory/${i.id as string}` },
	"cards.create": { method: "POST", path: () => "cards" },
	"cards.update": { method: "PATCH", path: (i) => `cards/${i.cardId as string}` },
	"cards.move": { method: "POST", path: () => "cards/move" },
	"cards.delete": { method: "DELETE", path: (i) => `cards/${i.cardId as string}` },
	"cards.addReviewComment": { method: "POST", path: () => "cards/add-review-comment" },
	"cards.interruptTask": { method: "POST", path: () => "cards/interrupt-task" },
	"cards.setPrMeta": { method: "POST", path: () => "cards/set-pr-meta" },
	"cards.setPlan": { method: "POST", path: () => "cards/set-plan" },
	"workflows.upsert": { method: "POST", path: () => "workflows" },
	"projectConfig.setGitInstructions": { method: "POST", path: () => "project-config/git-instructions" },
	"projectConfig.setSystemPrompt": { method: "POST", path: () => "project-config/system-prompt" },
	"memory.propose": { method: "POST", path: () => "memory/propose" },
	"memory.proposeUpdate": { method: "POST", path: () => "memory/propose-update" },
	"recurring.list": { method: "GET", path: () => "recurring-agents" },
	"recurring.create": { method: "POST", path: () => "recurring-agents" },
	"recurring.update": { method: "PATCH", path: (i) => `recurring-agents/${i.id as string}` },
	"recurring.delete": { method: "DELETE", path: (i) => `recurring-agents/${i.id as string}` },
	"recurring.setJournal": { method: "POST", path: (i) => `recurring-agents/${i.id as string}/journal` },
};

// Mutation (POST/PATCH/DELETE): input is the JSON body.
async function apiMutate<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
	const route = ROUTES[procedure];
	if (!route) throw new Error(`Unknown procedure: ${procedure}`);
	const res = await fetch(`${serverUrl}/api/${route.path(input)}`, {
		method: route.method,
		headers: { "Content-Type": "application/json", ...authHeaders },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`${procedure} failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

// Query (GET): input fields become query params; returns the parsed body (may be null).
async function apiQuery<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
	const route = ROUTES[procedure];
	if (!route) throw new Error(`Unknown procedure: ${procedure}`);
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(input)) {
		if (v !== undefined && v !== null) qs.set(k, String(v));
	}
	const query = qs.toString();
	const res = await fetch(`${serverUrl}/api/${route.path(input)}${query ? `?${query}` : ""}`, {
		headers: authHeaders,
		signal: AbortSignal.timeout(15000),
	});
	if (!res.ok) throw new Error(`${procedure} failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

const server = new McpServer({ name: "whipped", version: "1.0.0" });

// A recurring (observer) agent reads and reports but never mutates the board,
// workflows, or memory. Only these tools are exposed to the "recurring" role;
// every other tool (move/update/delete card, set plan/pr, upsert workflow,
// save memory, …) is withheld. Other roles are unaffected.
const RECURRING_OBSERVER_TOOLS = new Set([
	"kanban_get_board",
	"kanban_create_card",
	"kanban_add_comment",
	"kanban_get_workflows",
	"kanban_get_pr_meta",
	"kanban_get_git_instructions",
	"kanban_get_system_prompt",
	"whipped_search_memory",
	"whipped_get_memory",
	"update_journal",
	"disable_self",
]);

const baseRegisterTool = server.registerTool;
// Drop-in for server.registerTool that withholds mutating tools from observers.
const registerTool: typeof server.registerTool = ((name: string, ...rest: unknown[]) => {
	if (mcpRole === "recurring" && !RECURRING_OBSERVER_TOOLS.has(name)) return undefined;
	return (baseRegisterTool as (...a: unknown[]) => unknown).call(server, name, ...rest);
}) as typeof server.registerTool;

const attachmentInputSchema = z.object({
	type: z.string().describe("Attachment type — 'image' for images, 'file' for other files"),
	name: z.string().describe("Human-readable name for the attachment"),
	mimeType: z.string().describe("MIME type, e.g. image/png, application/pdf"),
	path: z.string().describe("Absolute file path to read from"),
});

async function processAttachments(
	attachments: Array<{ type: string; name: string; mimeType: string; path: string }>,
	cardId: string,
): Promise<Array<{ type: string; name: string; mimeType: string; path: string }>> {
	const { readFile } = await import("node:fs/promises");
	const { saveAttachment } = await import("../state/workspace-state.js");
	const results = [];
	for (const att of attachments) {
		try {
			const data = await readFile(att.path);
			const ext = att.path.split(".").pop() ?? "bin";
			const canonicalPath = await saveAttachment(data, ext, cardId);
			results.push({ type: att.type, name: att.name, mimeType: att.mimeType, path: canonicalPath });
		} catch {
			// Skip unreadable attachments
		}
	}
	return results;
}

registerTool(
	"kanban_get_board",
	{
		description: "Get the current Kanban board state including all cards and their columns.",
		inputSchema: {},
	},
	async () => {
		const state = await apiQuery<{ board: { columns: unknown[]; cards: unknown } }>("workspace.state", {
			workspaceId,
		});
		const board = state.board as {
			columns: Array<{ id: string; title: string; taskIds: string[] }>;
			cards: Record<
				string,
				{
					id: string;
					title?: string;
					description: string;
					columnId: string;
					type?: string;
					priority?: string;
					dependsOn?: string;
					waitsFor?: string[];
					subtaskIds?: string[];
				}
			>;
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
				const waitsTag = card.waitsFor && card.waitsFor.length > 0 ? ` (waits for: ${card.waitsFor.join(", ")})` : "";
				const depsTag = card.dependsOn ? ` (depends on: ${card.dependsOn})` : waitsTag;
				const cardDisplay = (card.description?.split("\n")[0] ?? "").slice(0, 80) || id;
				lines.push(`- [${id}]${typeTag} ${cardDisplay}${priorityTag}${depsTag}`);
				if (card.type === "story" && card.subtaskIds && card.subtaskIds.length > 0) {
					const met = card.subtaskIds.filter((subId) => {
						const sub = board.cards[subId];
						return sub?.columnId === "ready_for_review" || sub?.columnId === "done";
					});
					lines.push(`  Progress: ${met.length}/${card.subtaskIds.length} subtasks complete`);
				}
			}
		}

		return { content: [{ type: "text", text: lines.join("\n") || "Board is empty." }] };
	},
);

registerTool(
	"kanban_create_story",
	{
		description: `Create a story ticket with its subtasks in one atomic operation.

Creates all subtasks first, then the story card that depends on them. The story triggers its orchestrator workflow automatically when all subtasks reach 'Ready for Review' or 'Done'.

**Intra-batch dependencies:** If subtask B should run after subtask A (both in this batch), give subtask A a \`tempId\` (e.g. "auth") and list that tempId in subtask B's \`dependsOn\`. The real card IDs are wired up automatically after creation.`,
		inputSchema: {
			description: z
				.string()
				.describe(
					"Story description — what this story accomplishes as a whole, including acceptance criteria. The first line serves as the story title.",
				),
			priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("Story priority"),
			workflowId: z
				.string()
				.min(1)
				.describe(
					"REQUIRED. ID of the story orchestrator workflow. Call kanban_get_workflows first and pick the story workflow that best matches this story's scope; fall back to the default story workflow only if none fits.",
				),
			baseRef: z
				.string()
				.optional()
				.describe("Base branch for all cards in this story. Omit to use the repo default branch."),
			activeLevel: z
				.enum(["minimal", "low", "medium", "high", "max"])
				.optional()
				.describe(
					"Capability level for the story's orchestrator (orch) workflow. Each subtask sets its own level. Omit to default to the workflow's highest configured tier.",
				),
			attachments: z
				.array(attachmentInputSchema)
				.optional()
				.describe(
					"Files to attach (e.g. design docs, screenshots). Reference each one inline in the story description as [Attachment #N], where N is its 1-based position in this array.",
				),
			subtasks: z
				.array(
					z.object({
						tempId: z
							.string()
							.optional()
							.describe(
								"Short label to reference this subtask from other subtasks' dependsOn in this batch (e.g. 'auth', 'db-schema'). Not stored — only used for wiring up intra-batch deps.",
							),
						description: z
							.string()
							.describe("Subtask description with acceptance criteria. The first line serves as the subtask title."),
						priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("Subtask priority"),
						workflowId: z
							.string()
							.min(1)
							.describe(
								"REQUIRED. Workflow ID for this subtask (from kanban_get_workflows). Pick the workflow matching the subtask's nature (e.g. frontend vs backend); fall back to the default task workflow only if none fits.",
							),
						baseRef: z.string().optional().describe("Override base branch for this subtask only"),
						branchName: z
							.string()
							.min(1)
							.describe(
								"REQUIRED. Git branch name for this subtask: '<type>/<slug>' (e.g. 'fix/user-auth-bug', 'feat/dark-mode'). All lowercase, dashes not underscores, ≤60 chars.",
							),
						dependsOn: z
							.array(z.string())
							.optional()
							.describe(
								"Dependencies for this subtask. Use real card IDs for existing cards on the board, or tempId values to reference other subtasks in this same batch.",
							),
						activeLevel: z
							.enum(["minimal", "low", "medium", "high", "max"])
							.optional()
							.describe(
								"Capability level for this subtask's dev workflow. Omit to default to the workflow's highest configured tier; lower it for trivial subtasks.",
							),
						attachments: z
							.array(attachmentInputSchema)
							.optional()
							.describe(
								"Files to attach to this subtask. Reference each one inline in this subtask's description as [Attachment #N], where N is its 1-based position in this array.",
							),
					}),
				)
				.min(1)
				.describe(
					"Subtasks to create. At least one required. Each subtask gets type: 'subtask' and readyForDev: true automatically.",
				),
		},
	},
	async ({ description, priority, workflowId, baseRef, activeLevel, attachments, subtasks }) => {
		// Pass 1: create all subtasks without intra-batch deps, build tempId → realId map
		const tempIdToRealId = new Map<string, string>();
		const createdSubtasks: Array<{ realId: string; descFirst: string; rawDeps: string[] }> = [];

		for (const subtask of subtasks) {
			// Only pass existing board card IDs in this first pass — tempId refs aren't real yet
			const existingDeps = (subtask.dependsOn ?? []).filter((dep) => !subtasks.some((s) => s.tempId === dep));
			const card = await apiMutate<{ id: string }>("cards.create", {
				workspaceId,
				description: subtask.description,
				type: "subtask",
				priority: subtask.priority,
				readyForDev: true,
				baseRef: subtask.baseRef || baseRef || undefined,
				workflowId: subtask.workflowId || undefined,
				branchName: subtask.branchName || undefined,
				activeLevel: subtask.activeLevel,
				dependsOn: existingDeps[0],
			});
			if (subtask.attachments?.length) {
				const processed = await processAttachments(subtask.attachments, card.id);
				if (processed.length) {
					await apiMutate("cards.update", {
						workspaceId,
						cardId: card.id,
						descriptionAttachments: processed,
						revision: 0,
					});
				}
			}
			if (subtask.tempId) tempIdToRealId.set(subtask.tempId, card.id);
			createdSubtasks.push({
				realId: card.id,
				descFirst: subtask.description.split("\n")[0] ?? "",
				rawDeps: subtask.dependsOn ?? [],
			});
		}

		// Pass 2: wire up any intra-batch tempId deps that are now resolvable
		for (const { realId, rawDeps } of createdSubtasks) {
			const batchDeps = rawDeps.filter((dep) => tempIdToRealId.has(dep));
			if (batchDeps.length === 0) continue;
			const resolvedBatchDeps = batchDeps.map((dep) => tempIdToRealId.get(dep)!);
			const existingDeps = rawDeps.filter((dep) => !tempIdToRealId.has(dep));
			await apiMutate("cards.update", {
				workspaceId,
				cardId: realId,
				dependsOn: [...existingDeps, ...resolvedBatchDeps][0],
				revision: 0,
			});
		}

		// Create the story card depending on all subtasks
		const subtaskIds = createdSubtasks.map((s) => s.realId);
		const storyCard = await apiMutate<{ id: string }>("cards.create", {
			workspaceId,
			description,
			type: "story",
			priority,
			baseRef: baseRef || undefined,
			workflowId: workflowId || undefined,
			activeLevel,
			subtaskIds,
		});
		if (attachments?.length) {
			const processed = await processAttachments(attachments, storyCard.id);
			if (processed.length) {
				await apiMutate("cards.update", {
					workspaceId,
					cardId: storyCard.id,
					descriptionAttachments: processed,
					revision: 0,
				});
			}
		}

		const storyDisplay = description.split("\n")[0]?.slice(0, 80) ?? storyCard.id;
		const lines = [`Created story [${storyCard.id}] "${storyDisplay}" with ${subtaskIds.length} subtask(s):`];
		for (const { realId, descFirst } of createdSubtasks)
			lines.push(`  Subtask [${realId}] "${descFirst.slice(0, 80)}"`);
		lines.push(`The story will trigger its orchestrator workflow once all subtasks complete.`);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	},
);

registerTool(
	"kanban_create_card",
	{
		description: "Create a new task card on the Kanban board.",
		inputSchema: {
			description: z
				.string()
				.describe("Full task description including acceptance criteria. The first line serves as the display title."),
			type: z
				.enum(["task", "story", "subtask"])
				.optional()
				.describe(
					"Card type — 'task' (default), 'story' (orchestrator ticket with subtasks), or 'subtask' (child of a story)",
				),
			priority: z
				.enum(["urgent", "high", "medium", "low"])
				.optional()
				.describe("Task priority — urgent cards are dispatched first in autonomous mode"),
			readyForDev: z
				.boolean()
				.optional()
				.describe(
					"Mark the card as ready for the agent to pick up automatically. Defaults to false (true for story cards).",
				),
			columnId: z.enum(["todo", "blocked"]).optional().describe("Starting column — defaults to 'todo'"),
			dependsOn: z
				.string()
				.optional()
				.describe(
					"Single parent card ID this card is stacked on — it continues in the parent's worktree and starts once the parent reaches ready_for_review. Mutually exclusive with waitsFor.",
				),
			waitsFor: z
				.array(z.string())
				.optional()
				.describe(
					"Card IDs this card waits for — it starts in a fresh worktree from the base branch only once ALL of them are done. Mutually exclusive with dependsOn.",
				),
			workflowId: z
				.string()
				.min(1)
				.describe(
					"REQUIRED. ID of the workflow this task runs. Call kanban_get_workflows first, then pick the workflow whose name/purpose best matches the task (e.g. a frontend workflow for UI-only work, a backend workflow for API work). Only fall back to the default task workflow if none is a good fit.",
				),
			activeLevel: z
				.enum(["minimal", "low", "medium", "high", "max"])
				.optional()
				.describe(
					"Capability level the whole pipeline runs at (each slot maps it to its own model via the slot's pairs + mode). Higher = more capable/expensive. Omit to default to the workflow's highest configured tier; lower it for trivial work.",
				),
			attachments: z
				.array(attachmentInputSchema)
				.optional()
				.describe(
					"Files to attach (e.g. screenshots, design docs, PDFs). Reference each one inline in the description as [Attachment #N], where N is its 1-based position in this array (first → [Attachment #1]).",
				),
			branchName: z
				.string()
				.min(1)
				.describe(
					"REQUIRED. Git branch name for this card, derived from the title: '<type>/<slug>' (e.g. 'fix/user-auth-bug', 'feat/dark-mode'). All lowercase, dashes not underscores, ≤60 chars.",
				),
		},
	},
	async ({
		description,
		type,
		priority,
		readyForDev,
		columnId,
		dependsOn,
		waitsFor,
		workflowId,
		activeLevel,
		attachments,
		branchName,
	}) => {
		const card = await apiMutate<{ id: string; columnId: string }>("cards.create", {
			workspaceId,
			description,
			type,
			priority,
			readyForDev,
			dependsOn,
			waitsFor,
			columnId: columnId ?? "todo",
			workflowId,
			activeLevel,
			branchName: branchName || undefined,
		});
		if (attachments?.length) {
			const processed = await processAttachments(attachments, card.id);
			if (processed.length) {
				await apiMutate("cards.update", {
					workspaceId,
					cardId: card.id,
					descriptionAttachments: processed,
					revision: 0,
				});
			}
		}
		const cardDisplay = description.split("\n")[0]?.slice(0, 80) || card.id;
		return {
			content: [{ type: "text", text: `Created card [${card.id}] "${cardDisplay}" in ${card.columnId}.` }],
		};
	},
);

registerTool(
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
		await apiMutate("cards.move", { workspaceId, cardId, targetColumnId, revision: 0 });
		return { content: [{ type: "text", text: `Moved card ${cardId} to ${targetColumnId}.` }] };
	},
);

registerTool(
	"kanban_update_card",
	{
		description: "Update a card's description, priority, dependencies, workflow, readyForDev flag, or attachments.",
		inputSchema: {
			cardId: z.string().describe("The card ID"),
			description: z.string().optional().describe("New description"),
			priority: z.enum(["urgent", "high", "medium", "low"]).optional().describe("New priority level"),
			dependsOn: z
				.string()
				.optional()
				.describe(
					"Single parent card ID this card is stacked on (replaces existing). Mutually exclusive with waitsFor.",
				),
			waitsFor: z
				.array(z.string())
				.optional()
				.describe(
					"Card IDs this card waits for — starts only once all are done (replaces existing). Mutually exclusive with dependsOn.",
				),
			workflowId: z.string().optional().describe("ID of the workflow to assign to this card"),
			readyForDev: z.boolean().optional().describe("Whether the card is ready for the agent to pick up automatically"),
			activeLevel: z
				.enum(["minimal", "low", "medium", "high", "max"])
				.optional()
				.describe(
					"Capability level the pipeline runs at (each slot maps it to its own model). Raise for bigger scope, lower for trivial work. Omit to leave unchanged.",
				),
			attachments: z
				.array(attachmentInputSchema)
				.optional()
				.describe(
					"New files to append to the card's existing description attachments. Reference each one inline in the description as [Attachment #N], continuing the numbering after the card's existing attachments.",
				),
		},
	},
	async ({ cardId, description, priority, dependsOn, waitsFor, workflowId, readyForDev, activeLevel, attachments }) => {
		let descriptionAttachments: Array<{ type: string; name: string; mimeType: string; path: string }> | undefined;
		if (attachments?.length) {
			const state = await apiQuery<{
				board: {
					cards: Record<
						string,
						{ descriptionAttachments?: Array<{ type: string; name: string; mimeType: string; path: string }> }
					>;
				};
			}>("workspace.state", { workspaceId });
			const existing = state.board.cards[cardId]?.descriptionAttachments ?? [];
			const processed = await processAttachments(attachments, cardId);
			descriptionAttachments = [...existing, ...processed];
		}
		await apiMutate("cards.update", {
			workspaceId,
			cardId,
			description,
			priority,
			dependsOn,
			waitsFor,
			workflowId,
			readyForDev,
			activeLevel,
			descriptionAttachments,
			revision: 0,
		});
		return { content: [{ type: "text", text: `Updated card ${cardId}.` }] };
	},
);

registerTool(
	"kanban_add_comment",
	{
		description:
			"Record your analysis, findings, or summary as a comment on a Kanban card. Call this when you have finished your work so your output is cleanly stored.",
		inputSchema: {
			cardId: z.string().describe("The card ID you are reviewing"),
			type: z.string().describe("Type of comment — use the slot id for review agents (e.g. 'security_review')"),
			streamId: z.string().optional().describe("The terminal session stream ID for this agent run"),
			summary: z.string().describe("Your summary — 2-5 sentences describing what you did or found"),
			status: z.enum(["pass", "fail", "warning", "skipped"]).optional().describe("Result status of this review step"),
			issues: z
				.array(
					z.object({
						file: z.string().optional().describe("File path where the issue was found"),
						line: z.number().optional().describe("Line number of the issue"),
						severity: z.enum(["blocking", "warning", "info"]).describe("Severity level"),
						message: z.string().describe("Description of the issue"),
					}),
				)
				.optional()
				.describe("Specific issues found during review"),
			attachments: z.array(attachmentInputSchema).optional().describe("File attachments (e.g. screenshots, PDFs)"),
			metadata: z.record(z.string(), z.unknown()).optional().describe("Additional metadata key-value pairs"),
			suggestedLevel: z
				.enum(["minimal", "low", "medium", "high", "max"])
				.optional()
				.describe(
					"Only for review slots allowed to adjust the tier: the capability level the rework should run at when you fail/reopen (applies to all agents). Omit to leave unchanged.",
				),
		},
	},
	async ({ cardId, type, streamId, summary, status, issues, attachments, metadata, suggestedLevel }) => {
		const processedAttachments = attachments?.length ? await processAttachments(attachments, cardId) : undefined;
		// suggestedLevel rides on the comment metadata; the review pipeline reads it on reopen.
		const mergedMetadata = suggestedLevel ? { ...(metadata ?? {}), suggestedLevel } : metadata;

		await apiMutate("cards.addReviewComment", {
			workspaceId,
			cardId,
			type,
			streamId,
			actor: { type: "ai", id: agentId },
			status,
			summary,
			issues,
			attachments: processedAttachments,
			metadata: mergedMetadata,
		});
		return { content: [{ type: "text", text: `Comment recorded on card ${cardId}.` }] };
	},
);

registerTool(
	"kanban_set_plan",
	{
		description:
			"Save an implementation plan onto a card. Called by the plan agent when it finishes; the dev agent then reads this plan to implement the task.",
		inputSchema: {
			cardId: z.string().describe("The card ID to save the plan on"),
			plan: z.string().describe("The implementation plan — files to change, approach, edge cases, verification steps"),
		},
	},
	async ({ cardId, plan }) => {
		await apiMutate("cards.setPlan", { workspaceId, cardId, plan });
		return { content: [{ type: "text", text: `Plan saved on card ${cardId}.` }] };
	},
);

registerTool(
	"kanban_delete_card",
	{
		description: "Delete a card from the board permanently.",
		inputSchema: {
			cardId: z.string().describe("The card ID to delete"),
		},
	},
	async ({ cardId }) => {
		await apiMutate("cards.delete", { workspaceId, cardId });
		return { content: [{ type: "text", text: `Deleted card ${cardId}.` }] };
	},
);

registerTool(
	"kanban_stop_task",
	{
		description:
			"Stop an in-progress agent task. The session is marked 'stopped' (preserving history) so the card can be restarted later. Use this before moving a child card to todo when its parent was reopened.",
		inputSchema: {
			cardId: z.string().describe("The card ID of the in-progress task to stop"),
		},
	},
	async ({ cardId }) => {
		await apiMutate("cards.interruptTask", { workspaceId, cardId });
		return { content: [{ type: "text", text: `Task ${cardId} interrupted.` }] };
	},
);

registerTool(
	"kanban_get_workflows",
	{
		description:
			"Get all workflows configured for this project, including their agent slots, model tiers, tools, and prompts.",
		inputSchema: {},
	},
	async () => {
		const workflows = await apiQuery<
			Array<{
				id: string;
				name: string;
				isDefault: boolean;
				forStory?: boolean;
				slots: Array<{
					id: string;
					type: string;
					name: string;
					order: number;
					enabled: boolean;
					prompt: { source: "inline"; text: string } | { source: "file"; path: string };
					pairs: Array<{
						id: string;
						level: string;
						isFree: boolean;
						binary: string;
						model?: string | null;
						effort?: string | null;
					}>;
					mode: string;
					tools: string[];
					canAdjustLevel: boolean;
					rerun: boolean;
				}>;
			}>
		>("workflows.list", { workspaceId });

		const lines: string[] = [];
		for (const wf of workflows) {
			const kind = wf.forStory ? " [story/orch workflow]" : " [task workflow]";
			lines.push(`## ${wf.name}${wf.isDefault ? " (default)" : ""}${kind} [id: ${wf.id}]`);
			const sorted = [...wf.slots].sort((a, b) => a.order - b.order);
			for (const slot of sorted) {
				const status = slot.enabled ? "enabled" : "disabled";
				const top = slot.pairs[0];
				const topTag = top
					? `, top: ${top.binary}${top.model ? `/${top.model}` : ""}@${top.level}${top.effort ? `/${top.effort}` : ""}`
					: "";
				const pairsTag = `, ${slot.pairs.length} tier(s), mode: ${slot.mode}`;
				const toolsTag = slot.tools.length ? `, tools: ${slot.tools.join("+")}` : "";
				const flags = [slot.canAdjustLevel ? "canAdjustLevel" : "", slot.rerun ? "rerun" : ""]
					.filter(Boolean)
					.join(",");
				const flagsTag = flags ? `, ${flags}` : "";
				const promptText =
					slot.prompt && typeof slot.prompt === "object"
						? slot.prompt.source === "inline"
							? slot.prompt.text
							: `[file: ${slot.prompt.path}]`
						: "";
				const prompt = promptText ? `\n    prompt: ${promptText}` : "";
				lines.push(
					`  - [${slot.id}] ${slot.name} (${slot.type}${topTag}${pairsTag}, ${status}${toolsTag}${flagsTag})${prompt}`,
				);
			}
		}
		return { content: [{ type: "text", text: lines.join("\n") || "No workflows configured." }] };
	},
);

registerTool(
	"kanban_upsert_workflow",
	{
		description:
			"Create or update a workflow. Pass the full workflow object including all slots. If a workflow with the given id already exists it will be replaced; otherwise a new one is created.",
		inputSchema: {
			id: z.string().describe("Unique workflow ID. Use a short slug like 'wf_security' for new workflows."),
			name: z.string().describe("Human-readable workflow name, e.g. 'Security Review'"),
			isDefault: z.boolean().optional().describe("Whether this is the default workflow (only one can be default)"),
			forStory: z
				.boolean()
				.optional()
				.describe(
					"True for story/orchestrator workflows (orch slots only). False for regular task workflows (plan/dev/review slots).",
				),
			slots: z
				.array(
					z.object({
						id: z.string().describe("Unique slot ID within this workflow"),
						type: z
							.enum(["dev", "review", "plan", "orch"])
							.describe(
								"Slot type. 'dev' implements (only slot with write access). 'review' is a one-shot reviewer — chain several via order, grant tools as needed. 'plan' runs once before dev and saves a plan on the card. 'orch' is story-only.",
							),
						name: z.string().describe("Display name for this slot"),
						order: z.number().int().nonnegative().describe("Execution order (0 = first)"),
						enabled: z.boolean().describe("Whether this slot is active in the pipeline"),
						prompt: z
							.string()
							.describe("System prompt / instructions for this agent slot. Empty string for default behavior."),
						pairs: z
							.array(
								z.object({
									id: z.string().describe("Unique pair ID within this slot"),
									level: z
										.enum(["minimal", "low", "medium", "high", "max"])
										.describe("Capability level. The card's active level selects which pair runs."),
									isFree: z.boolean().describe("Whether this pair uses a zero-cost model"),
									binary: z
										.enum(["claude", "codex", "opencode", "cursor", "mimo"])
										.describe("Agent binary: claude / codex / opencode / cursor / mimo."),
									model: z
										.string()
										.nullable()
										.optional()
										.describe("Model override, or null for the agent default (e.g. 'claude-opus-4-6', 'gpt-5.5')."),
									effort: z
										.enum(["low", "medium", "high", "xhigh", "max"])
										.nullable()
										.optional()
										.describe("Reasoning effort override, or null for the agent default."),
								}),
							)
							.min(1)
							.describe(
								"Model tiers for this slot, in priority order (first = highest). The card copies these and picks one by active level + mode.",
							),
						mode: z
							.enum(["auto", "preferFree", "freeOnly", "paidOnly"])
							.optional()
							.describe(
								"Selection policy at the active level: auto = top priority; preferFree = top free else paid; freeOnly / paidOnly = restrict by cost. Defaults to auto.",
							),
						tools: z
							.array(z.enum(["browser"]))
							.optional()
							.describe("Tools granted to this slot, e.g. ['browser'] for Playwright UI control."),
						canAdjustLevel: z
							.boolean()
							.optional()
							.describe("review slots only: may set the card's active level on reopen via suggestedLevel."),
						rerun: z
							.boolean()
							.optional()
							.describe("plan slots only: re-run the plan even if the card already has one."),
					}),
				)
				.describe(
					"For task workflows: always include a dev slot (type: 'dev'). Add plan and/or review slots as needed. For story workflows: use only orch slots.",
				),
		},
	},
	async ({ id, name, isDefault, forStory, slots }) => {
		const workflow = await apiMutate<{ id: string; name: string }>("workflows.upsert", {
			workspaceId,
			workflow: { id, name, isDefault: isDefault ?? false, forStory: forStory ?? false, slots },
		});
		return { content: [{ type: "text", text: `Workflow "${workflow.name}" [${workflow.id}] saved successfully.` }] };
	},
);

registerTool(
	"kanban_get_pr_meta",
	{
		description:
			"Get the current PR metadata stored on a card — url (set by the daemon when the PR is created), title, description, and the updatedAt/updatedBy stamps from the last write. Use this when the dev prompt shows a truncated previous description and you need the full text to revise.",
		inputSchema: {
			cardId: z.string().describe("The card ID to read PR metadata from"),
		},
	},
	async ({ cardId }) => {
		const state = await apiQuery<{
			board: {
				cards: Record<
					string,
					{
						pr?: {
							url?: string;
							title?: string;
							description?: string;
							updatedAt?: number;
							updatedBy?: string;
						};
					}
				>;
			};
		}>("workspace.state", { workspaceId });
		const card = state.board.cards[cardId];
		if (!card) {
			return {
				content: [
					{ type: "text", text: `Card ${cardId} not found on the board. Use kanban_get_board to list valid card IDs.` },
				],
			};
		}
		const pr = card.pr;
		if (!pr || (!pr.url && !pr.title && !pr.description)) {
			return { content: [{ type: "text", text: `No PR metadata on card ${cardId} yet.` }] };
		}
		const lines = [
			`url: ${pr.url ?? "(not yet created)"}`,
			`title: ${pr.title ?? "(unset)"}`,
			"",
			"description:",
			pr.description ?? "(unset)",
		];
		if (pr.updatedAt) lines.push("", `last updated: ${new Date(pr.updatedAt).toISOString()} by ${pr.updatedBy ?? "?"}`);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	},
);

registerTool(
	"kanban_set_pr_meta",
	{
		description:
			"Set the PR title and/or description for a card. Call this at the end of your work so the daemon uses your text when it creates the PR. The PR url is set by the daemon and never overwritten by this call. Subsequent calls overwrite previous values — revise rather than rewrite when prior values already reflect the change.",
		inputSchema: {
			cardId: z.string().describe("The card ID this PR is for"),
			title: z.string().optional().describe("PR title. Follow the project's git instructions."),
			description: z.string().optional().describe("PR description body. Follow the project's git instructions."),
			streamId: z.string().optional().describe("Terminal session stream ID for this agent run, if available"),
		},
	},
	async ({ cardId, title, description, streamId }) => {
		const result = await apiMutate<{ ok: boolean; pr: { title?: string; description?: string } }>("cards.setPrMeta", {
			workspaceId,
			cardId,
			title,
			description,
			updatedBy: streamId ?? agentId,
		});
		const parts: string[] = [];
		if (result.pr.title) parts.push(`title="${result.pr.title}"`);
		if (result.pr.description) parts.push(`description (${result.pr.description.length} chars)`);
		return {
			content: [{ type: "text", text: `PR meta updated on card ${cardId}: ${parts.join(", ") || "(empty)"}.` }],
		};
	},
);

registerTool(
	"kanban_get_git_instructions",
	{
		description:
			"Get the project's git conventions for PR titles, PR descriptions, and commit messages. Returns the user's custom override (if any), the built-in default, and the effective text that the dev prompt actually injects. Read this before writing PR meta so you follow project conventions.",
		inputSchema: {},
	},
	async () => {
		const config = await apiQuery<{ gitInstructions?: string }>("projectConfig.get", { workspaceId });
		const custom = config.gitInstructions?.trim() ? config.gitInstructions : null;
		const effective = custom ?? DEFAULT_GIT_INSTRUCTIONS;
		const lines: string[] = [];
		lines.push(
			custom ? "## Custom git instructions (project override)" : "## Custom git instructions: (none — using default)",
		);
		if (custom) lines.push(custom);
		lines.push("");
		lines.push("## Default git instructions");
		lines.push(DEFAULT_GIT_INSTRUCTIONS);
		lines.push("");
		lines.push("## Effective (what dev agents actually see)");
		lines.push(effective);
		return { content: [{ type: "text", text: lines.join("\n") }] };
	},
);

registerTool(
	"kanban_set_git_instructions",
	{
		description:
			"Replace the project's custom git conventions (PR title/description/commit rules). This is project-wide and affects all future PRs in this workspace — only call when explicitly asked to change conventions, not as part of regular task work. Pass an empty string to clear the override and revert to the built-in default.",
		inputSchema: {
			instructions: z
				.string()
				.describe(
					"Full replacement text in markdown or freeform prose. Pass an empty string to clear the override and use the default.",
				),
		},
	},
	async ({ instructions }) => {
		const result = await apiMutate<{ ok: boolean; cleared: boolean }>("projectConfig.setGitInstructions", {
			workspaceId,
			instructions,
		});
		return {
			content: [
				{
					type: "text",
					text: result.cleared
						? "Custom git instructions cleared — using default."
						: "Custom git instructions updated.",
				},
			],
		};
	},
);

registerTool(
	"kanban_get_system_prompt",
	{
		description:
			"Get the shared system prompt for this project. This prompt is appended to every agent — plan, dev, review, and the assistant chat.",
		inputSchema: {},
	},
	async () => {
		const config = await apiQuery<{ systemPrompt?: string }>("projectConfig.get", { workspaceId });
		const prompt = config.systemPrompt?.trim();
		return { content: [{ type: "text", text: prompt ? prompt : "(no shared system prompt set)" }] };
	},
);

registerTool(
	"kanban_set_system_prompt",
	{
		description:
			"Set or update the shared system prompt for this project. The prompt is appended to every agent — plan, dev, review, and the assistant chat. Pass an empty string to clear it.",
		inputSchema: {
			prompt: z.string().describe("The new shared system prompt. Pass an empty string to clear the existing prompt."),
		},
	},
	async ({ prompt }) => {
		const result = await apiMutate<{ ok: boolean; cleared: boolean }>("projectConfig.setSystemPrompt", {
			workspaceId,
			prompt,
		});
		return {
			content: [
				{ type: "text", text: result.cleared ? `Shared system prompt cleared.` : `Shared system prompt updated.` },
			],
		};
	},
);

// Cursor Agent CLI does not fire a settings.json "stop" hook reliably, so we expose
// task_complete as an MCP tool that cursor can call explicitly to signal completion.
// Other agents ignore it (they use their own stop mechanisms).
registerTool(
	"task_complete",
	{
		description:
			"Signal that you have finished all work on this task. Call this ONLY after you have completed all code changes, called kanban_set_pr_meta, and called kanban_add_comment with your final status. This terminates the agent session.",
		inputSchema: {},
	},
	async () => {
		const taskId = process.env.WHIPPED_HOOK_TASK_ID;
		const wsId = process.env.WHIPPED_HOOK_WORKSPACE_ID;
		if (taskId && wsId) {
			await fetch(
				`${serverUrl}/api/hook?event=stop&taskId=${encodeURIComponent(taskId)}&workspaceId=${encodeURIComponent(wsId)}`,
				{ headers: authHeaders },
			).catch(() => {});
		}
		return { content: [{ type: "text", text: "Task completion signaled. Your session will now end." }] };
	},
);

// ─── Memory ───────────────────────────────────────────────────────────────────
// Slot + card context are inherited from the agent process env (the MCP server
// is a stdio child). Read tools are available to every slot; write tools are
// registered for the dev and assistant slots.
const agentSlot = process.env.WHIPPED_SLOT ?? "";
const hookTaskId = process.env.WHIPPED_HOOK_TASK_ID ?? "";
// The assistant agent's task id is synthetic (no row in `cards`), so it must not
// be used as an origin_card_id foreign key — only real card ids qualify.
const memoryCardId = hookTaskId.startsWith(ASSISTANT_AGENT_PREFIX) ? "" : hookTaskId;
const memoryModel = process.env.WHIPPED_MODEL ?? "";

interface MemoryResult {
	id: string;
	scope: string;
	type: string;
	title: string;
	content: string;
}

registerTool(
	"whipped_search_memory",
	{
		description:
			"Search durable project + global memory (conventions, decisions, lessons, sharp edges) for this workspace. Use before re-discovering how something works. Returns matching memories with their ids.",
		inputSchema: {
			query: z.string().describe("Keywords to search memory titles and content"),
		},
	},
	async ({ query }) => {
		try {
			const results = await apiQuery<MemoryResult[]>("memory.search", { query, workspaceId });
			if (!results || results.length === 0) {
				return { content: [{ type: "text", text: "No matching memory." }] };
			}
			const text = results.map((m) => `- [${m.id}] (${m.scope}/${m.type}) ${m.title}\n  ${m.content}`).join("\n");
			return { content: [{ type: "text", text }] };
		} catch (err) {
			return { content: [{ type: "text", text: `Search failed: ${(err as Error).message}` }] };
		}
	},
);

registerTool(
	"whipped_get_memory",
	{
		description: "Fetch the full content of a single memory by its id (from whipped_search_memory results).",
		inputSchema: {
			id: z.string().describe("Memory id"),
		},
	},
	async ({ id }) => {
		try {
			const m = await apiQuery<MemoryResult | null>("memory.get", { id });
			if (!m) return { content: [{ type: "text", text: "Memory not found." }] };
			return { content: [{ type: "text", text: `(${m.scope}/${m.type}) ${m.title}\n\n${m.content}` }] };
		} catch (err) {
			return { content: [{ type: "text", text: `Fetch failed: ${(err as Error).message}` }] };
		}
	},
);

// Write tools — dev and assistant slots.
if (agentSlot === "dev" || agentSlot === "assistant") {
	registerTool(
		"whipped_save_memory",
		{
			description:
				"Save a durable memory: a cross-cutting rule or a non-obvious trap that a careful reader of the code would still get wrong. Non-derivability is the bar — NOT how long it took to find. If the fact lives in one file, the API schema, or a controller (endpoint request/response shapes, query params, column lists, field names, CSS/colour classes, per-page layout), do NOT save it — that is code, read it when you need it. The test: if your note has to cite the file where the truth lives, the file IS the memory; skip it. Save for conventions, architecture decisions, repo-wide gotchas, or user corrections. Most tasks produce nothing memory-worthy — that is the expected outcome, not a gap. Keep each memory to ONE focused fact in 1-3 sentences (~60 words max); a multi-paragraph dump is a sign it belongs in the code, not here. Scope 'project' = specific to this repo; 'global' = a fact shareable across projects (e.g. a framework/library convention). The user may review project task-lessons; global lessons go to a review queue.\n\nGlobal memory REQUIRES tags — it only reaches another project that subscribes to one of its tags. Tag with the framework-qualified form when the knowledge is ecosystem-specific, and the bare form only when the fact is truly tool-level and framework-agnostic: Spoosh used via its React bindings → 'spoosh-react'; a fact about Spoosh itself → 'spoosh'; React hooks → 'react-hook' (not bare 'hook'). Reuse an existing tag from the injected memory's tag list before inventing a near-duplicate.",
			inputSchema: {
				scope: z.enum(["project", "global"]).describe("'project' (this repo) or 'global' (shareable across projects)"),
				type: z
					.enum(["fact", "convention", "decision", "preference", "rule", "lesson", "sharp_edge"])
					.describe("Kind of memory"),
				title: z.string().describe("Short one-line summary"),
				content: z
					.string()
					.describe("The durable fact, in 1-3 sentences (~60 words). One fact only — not a page or endpoint spec."),
				sourceType: z
					.enum(["user_correction", "explicit_save", "task_lesson"])
					.default("task_lesson")
					.describe("Why this is being saved — 'user_correction' if the user explicitly told you, else 'task_lesson'"),
				importance: z.number().int().min(1).max(3).optional().describe("1 normal, 2 high, 3 critical"),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						"Required for 'global' scope (≥1). Canonical kebab-case, framework-qualified when ecosystem-specific (e.g. 'spoosh-react', 'react-hook'). Reuse existing tags.",
					),
			},
		},
		async ({ scope, type, title, content, sourceType, importance, tags }) => {
			try {
				const saved = await apiMutate<{ status: string }>("memory.propose", {
					scope,
					workspaceId: scope === "project" ? workspaceId : undefined,
					originWorkspaceId: workspaceId,
					type,
					title,
					content,
					sourceType,
					importance,
					tags,
					originCardId: memoryCardId || undefined,
					originAgent: { agent: agentId, ...(memoryModel ? { model: memoryModel } : {}) },
				});
				const note = saved.status === "approved" ? "saved (approved)." : "submitted for the user's review (pending).";
				return { content: [{ type: "text", text: `Memory ${note}` }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Save failed: ${(err as Error).message}` }] };
			}
		},
	);

	registerTool(
		"whipped_update_memory",
		{
			description:
				"Update an existing memory when it is now inaccurate or out of date (e.g. a convention changed). Get the memory's id from the injected memory list or whipped_search_memory. Prefer updating over saving a near-duplicate. Approval follows the same policy as saving.",
			inputSchema: {
				id: z.string().describe("Memory id (from the memory list or whipped_search_memory)"),
				title: z.string().optional().describe("New title"),
				content: z.string().optional().describe("New content"),
				type: z.enum(["fact", "convention", "decision", "preference", "rule", "lesson", "sharp_edge"]).optional(),
				importance: z.number().int().min(1).max(3).optional(),
				sourceType: z
					.enum(["user_correction", "explicit_save", "task_lesson"])
					.default("task_lesson")
					.describe("'user_correction' if the user told you to change it, else 'task_lesson'"),
			},
		},
		async ({ id, title, content, type, importance, sourceType }) => {
			try {
				const updated = await apiMutate<{ status: string }>("memory.proposeUpdate", {
					id,
					title,
					content,
					type,
					importance,
					sourceType,
				});
				const note =
					updated.status === "approved" ? "updated (approved)." : "update submitted for the user's review (pending).";
				return { content: [{ type: "text", text: `Memory ${note}` }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Update failed: ${(err as Error).message}` }] };
			}
		},
	);
}

// ─── Recurring agents (role-gated) ──────────────────────────────────────────

const scheduleShape = {
	scheduleKind: z
		.enum(["interval", "calendar"])
		.describe("'interval' = every N seconds; 'calendar' = cron at a wall-clock time"),
	intervalSeconds: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Required when scheduleKind=interval (e.g. 3600 = hourly)"),
	cronExpr: z
		.string()
		.optional()
		.describe("Required when scheduleKind=calendar, e.g. '0 9 * * 1' = every Monday 09:00"),
	timezone: z.string().optional().describe("IANA timezone, required when scheduleKind=calendar (e.g. 'Asia/Yangon')"),
	agentBinary: z
		.enum(["claude", "codex", "opencode", "cursor", "mimo"])
		.optional()
		.describe("Which agent runs this; defaults to claude"),
	model: z.string().optional().describe("Model id, e.g. 'claude-opus-4-8' or 'gpt-5.5'"),
	effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
	enabled: z.boolean().optional(),
};

type ScheduleInput = {
	scheduleKind: "interval" | "calendar";
	intervalSeconds?: number;
	cronExpr?: string;
	timezone?: string;
	agentBinary?: string;
	model?: string;
	effort?: string;
	enabled?: boolean;
};

function buildScheduleBody(input: ScheduleInput) {
	const schedule =
		input.scheduleKind === "calendar"
			? { kind: "calendar", cronExpr: input.cronExpr ?? "0 9 * * 1", timezone: input.timezone ?? "UTC" }
			: { kind: "interval", intervalSeconds: input.intervalSeconds ?? 3600 };
	const model = input.agentBinary
		? { agentId: input.agentBinary, model: input.model ?? null, effort: input.effort ?? null }
		: undefined;
	return { schedule, model };
}

if (mcpRole === "assistant") {
	registerTool(
		"recurring_create",
		{
			description:
				"Create a scheduled recurring agent for this project (e.g. an hourly Jira checker or a weekly security sweep). Only you, the assistant, can create these — recurring agents cannot create others. They observe and report; they do not write code.",
			inputSchema: {
				name: z.string().describe("Short name, e.g. 'Security sweep'"),
				instructions: z.string().describe("What the agent should do each run, and how to use its journal"),
				...scheduleShape,
			},
		},
		async (input) => {
			try {
				const { schedule, model } = buildScheduleBody(input as ScheduleInput);
				const created = await apiMutate<{ id: string; name: string }>("recurring.create", {
					workspaceId,
					name: input.name,
					instructions: input.instructions,
					schedule,
					model,
					enabled: input.enabled,
				});
				return { content: [{ type: "text", text: `Created recurring agent "${created.name}" [${created.id}].` }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Create failed: ${(err as Error).message}` }] };
			}
		},
	);

	registerTool(
		"recurring_list",
		{ description: "List the recurring agents configured for this project.", inputSchema: {} },
		async () => {
			const agents = await apiQuery<
				Array<{ id: string; name: string; enabled: boolean; nextRunAt?: number; schedule: { kind: string } }>
			>("recurring.list", { workspaceId });
			if (!agents.length) return { content: [{ type: "text", text: "No recurring agents configured." }] };
			const lines = agents.map(
				(a) =>
					`[${a.id}] ${a.name} — ${a.enabled ? "enabled" : "disabled"}, ${a.schedule.kind}${a.nextRunAt ? `, next ${new Date(a.nextRunAt).toISOString()}` : ""}`,
			);
			return { content: [{ type: "text", text: lines.join("\n") }] };
		},
	);

	registerTool(
		"recurring_update",
		{
			description: "Update a recurring agent (rename, re-schedule, change model, enable/disable).",
			inputSchema: {
				id: z.string(),
				name: z.string().optional(),
				instructions: z.string().optional(),
				...scheduleShape,
			},
		},
		async (input) => {
			try {
				const body: Record<string, unknown> = { id: input.id, name: input.name, instructions: input.instructions };
				if (input.scheduleKind) {
					const { schedule, model } = buildScheduleBody(input as ScheduleInput);
					body.schedule = schedule;
					if (model) body.model = model;
				}
				if (input.enabled !== undefined) body.enabled = input.enabled;
				await apiMutate("recurring.update", body);
				return { content: [{ type: "text", text: `Updated recurring agent ${input.id}.` }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Update failed: ${(err as Error).message}` }] };
			}
		},
	);

	registerTool(
		"recurring_delete",
		{ description: "Delete a recurring agent.", inputSchema: { id: z.string() } },
		async ({ id }) => {
			try {
				await apiMutate("recurring.delete", { id });
				return { content: [{ type: "text", text: `Deleted recurring agent ${id}.` }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Delete failed: ${(err as Error).message}` }] };
			}
		},
	);
}

if (mcpRole === "recurring" && recurringAgentId) {
	registerTool(
		"update_journal",
		{
			description:
				"Rewrite your private journal — the notes you carry across runs (e.g. what you've already filed, what you're watching). Read it at the start of a run and rewrite the full updated text here at the end. This replaces the journal entirely, so include everything worth keeping.",
			inputSchema: { journal: z.string().describe("The full updated journal text") },
		},
		async ({ journal }) => {
			try {
				await apiMutate("recurring.setJournal", { id: recurringAgentId, journal });
				return { content: [{ type: "text", text: "Journal saved." }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Journal save failed: ${(err as Error).message}` }] };
			}
		},
	);

	registerTool(
		"disable_self",
		{
			description:
				"Disable yourself so you stop running on schedule. Use this once your assigned task is complete and there is nothing left to watch for — e.g. a one-off job that has finished, or a condition you were waiting on that is now resolved. This only pauses future runs; the user can re-enable you later. It does not affect the current run, which finishes normally.",
			inputSchema: {},
		},
		async () => {
			try {
				await apiMutate("recurring.update", { id: recurringAgentId, enabled: false });
				return { content: [{ type: "text", text: "Disabled. No further scheduled runs until re-enabled." }] };
			} catch (err) {
				return { content: [{ type: "text", text: `Disable failed: ${(err as Error).message}` }] };
			}
		},
	);
}

const transport = new StdioServerTransport();
await server.connect(transport);
