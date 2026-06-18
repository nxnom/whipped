import {
	cardTypeSchema,
	resolveWorkflowForCard,
	type RuntimeBoardCard,
	type RuntimeBulkCardImportItem,
	runtimeAgentIdSchema,
	runtimeCardPrioritySchema,
	tierLevelSchema,
	type Workflow,
} from "@runtime-contract";
import type { ParsedImport, ParsedImportRow } from "./types";

// Pull the JSON out of a ```json fenced block when present, so output pasted
// straight from an AI assistant works without hand-editing.
const stripFence = (text: string): string => {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	return fence ? fence[1]!.trim() : text;
};

const asArray = (input: unknown): unknown[] | null => {
	if (Array.isArray(input)) return input;
	// Tolerate the wrapped `{ "cards": [...] }` shape an LLM may emit.
	if (input && typeof input === "object" && Array.isArray((input as { cards?: unknown }).cards)) {
		return (input as { cards: unknown[] }).cards;
	}
	return null;
};

const enumError = (value: unknown, allowed: readonly string[], field: string): string | null =>
	typeof value === "string" && !allowed.includes(value)
		? `${field} "${value}" is invalid (allowed: ${allowed.join(", ")})`
		: null;

const refList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

// Validate + normalize the pasted JSON against the same rules the server enforces,
// so the preview is trustworthy and confirm is only enabled when every row passes.
export function parseImport(
	raw: string,
	workflows: Workflow[],
	allCards: Record<string, RuntimeBoardCard>,
): ParsedImport {
	const trimmed = stripFence(raw.trim());
	if (!trimmed) return { rows: [], valid: false };

	let json: unknown;
	try {
		json = JSON.parse(trimmed);
	} catch (err) {
		return { rows: [], valid: false, fatal: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}

	const list = asArray(json);
	if (!list) return { rows: [], valid: false, fatal: "Expected a JSON array of tickets." };
	if (list.length === 0) return { rows: [], valid: false, fatal: "The array is empty — nothing to import." };

	const hasStoryWorkflow = workflows.some((w) => w.forStory);
	const existingIds = new Set(Object.keys(allCards));
	const tempIds = new Set(
		list
			.map((el) => (el && typeof el === "object" ? (el as { tempId?: unknown }).tempId : undefined))
			.filter((t): t is string => typeof t === "string"),
	);

	const rows: ParsedImportRow[] = list.map((el, index) => {
		const errors: string[] = [];
		if (!el || typeof el !== "object" || Array.isArray(el)) {
			return {
				index,
				title: "—",
				type: "task",
				priority: "",
				resolvedWorkflowName: "—",
				defaulted: false,
				deps: [],
				errors: ["Each ticket must be a JSON object."],
			};
		}

		const obj = el as Record<string, unknown>;
		const description = typeof obj.description === "string" ? obj.description : "";
		if (!description.trim()) errors.push("description is required");

		const type = typeof obj.type === "string" ? obj.type : "task";
		for (const e of [
			enumError(obj.type, cardTypeSchema.options, "type"),
			enumError(obj.priority, runtimeCardPrioritySchema.options, "priority"),
			enumError(obj.agentId, runtimeAgentIdSchema.options, "agentId"),
			enumError(obj.activeLevel, tierLevelSchema.options, "activeLevel"),
		]) {
			if (e) errors.push(e);
		}
		if ((type === "story" || type === "subtask") && !hasStoryWorkflow) {
			errors.push("story/subtask tickets require a story workflow — create one first");
		}

		const workflowId = typeof obj.workflowId === "string" ? obj.workflowId : undefined;
		const resolved = resolveWorkflowForCard(workflows, { workflowId, type: type as never });
		const defaulted = !workflowId || resolved?.id !== workflowId;

		const dependsOn = typeof obj.dependsOn === "string" ? obj.dependsOn : undefined;
		const waitsFor = refList(obj.waitsFor);
		const subtaskIds = refList(obj.subtaskIds);
		const deps = [...(dependsOn ? [dependsOn] : []), ...waitsFor, ...subtaskIds];
		for (const ref of deps) {
			if (!tempIds.has(ref) && !existingIds.has(ref)) errors.push(`unknown reference "${ref}"`);
		}

		const item: RuntimeBulkCardImportItem | undefined =
			errors.length === 0
				? {
						description: description.trim(),
						tempId: typeof obj.tempId === "string" ? obj.tempId : undefined,
						type: type === "task" ? undefined : (type as never),
						priority: typeof obj.priority === "string" ? (obj.priority as never) : undefined,
						agentId: typeof obj.agentId === "string" ? (obj.agentId as never) : undefined,
						activeLevel: typeof obj.activeLevel === "string" ? (obj.activeLevel as never) : undefined,
						workflowId,
						readyForDev: typeof obj.readyForDev === "boolean" ? obj.readyForDev : undefined,
						branchName: typeof obj.branchName === "string" ? obj.branchName : undefined,
						baseRef: typeof obj.baseRef === "string" ? obj.baseRef : undefined,
						githubIssueUrl: typeof obj.githubIssueUrl === "string" ? obj.githubIssueUrl : undefined,
						dependsOn,
						waitsFor: waitsFor.length > 0 ? waitsFor : undefined,
						subtaskIds: subtaskIds.length > 0 ? subtaskIds : undefined,
					}
				: undefined;

		return {
			index,
			title: description.trim().split("\n")[0] || "—",
			type,
			priority: typeof obj.priority === "string" ? obj.priority : "",
			resolvedWorkflowName: resolved?.name ?? "none",
			defaulted,
			deps,
			errors,
			item,
		};
	});

	return { rows, valid: rows.every((r) => r.errors.length === 0) };
}
