import { z } from "zod";
import {
	effortLevelSchema,
	pairSelectionModeSchema,
	runtimeAgentIdSchema,
	slotToolSchema,
	tierLevelSchema,
	workflowSchema,
	workflowSlotSchema,
} from "../api-contract.js";

// Form-side prompt union. The contract's `promptValueSchema` wraps the union in a
// `z.preprocess` (to upgrade legacy bare strings on read), which makes its zod
// input type `unknown` and breaks RHF's resolver input/output inference. Workflow
// data reaching the editor is already contract-parsed, so the form uses the plain
// discriminated union — keeping the schema's input and output types identical.
export const promptValueFormSchema = z.discriminatedUnion("source", [
	z.object({ source: z.literal("inline"), text: z.string() }),
	z.object({ source: z.literal("file"), path: z.string() }),
]);
export type PromptValueForm = z.infer<typeof promptValueFormSchema>;

// ─── Model pair form ─────────────────────────────────────────────────────────
// Mirrors modelPairSchema but without zod `.default()`s, so the form's input and
// output types stay identical (required by RHF's resolver inference). The "Default"
// model/effort option clears the field to null.
export const modelPairFormSchema = z.object({
	id: z.string(),
	level: tierLevelSchema,
	isFree: z.boolean(),
	binary: runtimeAgentIdSchema,
	model: z.string().nullable(),
	effort: effortLevelSchema.nullable(),
});
export type ModelPairForm = z.infer<typeof modelPairFormSchema>;

// ─── Slot form ─────────────────────────────────────────────────────────────
// Mirrors workflowSlotSchema but tightens a few fields for the editor:
//  - `name` is required (a blank slot label is never useful).
//  - `prompt` keeps the discriminated inline/file union so the inline-vs-file
//    toggle round-trips losslessly.
//  - model selection lives in `pairs` (per tier), not flat binary/model/effort.
export const workflowSlotFormSchema = z.object({
	id: workflowSlotSchema.shape.id,
	type: workflowSlotSchema.shape.type,
	name: z.string().min(1, "Name is required"),
	order: workflowSlotSchema.shape.order,
	enabled: z.boolean(),
	prompt: promptValueFormSchema,
	pairs: z.array(modelPairFormSchema).min(1, "At least one model tier is required"),
	mode: pairSelectionModeSchema,
	tools: z.array(slotToolSchema),
	canAdjustLevel: z.boolean(),
	rerun: z.boolean(),
});
export type WorkflowSlotForm = z.infer<typeof workflowSlotFormSchema>;

// ─── Workflow form ─────────────────────────────────────────────────────────
// The full editor form. Composed from workflowSchema so the persisted shape and
// the form shape can't drift, with `name` required and `slots` retyped to the
// form slot schema for the useFieldArray editor. `isDefault`/`forStory` are plain
// booleans here (not the contract's `.default(false)`) so the schema's input and
// output types match — the form always supplies them via `values`.
export const workflowFormSchema = z.object({
	id: workflowSchema.shape.id,
	name: z.string().min(1, "Workflow name is required"),
	isDefault: z.boolean(),
	forStory: z.boolean(),
	slots: z.array(workflowSlotFormSchema),
});
export type WorkflowForm = z.infer<typeof workflowFormSchema>;

// ─── Prompt-link form ──────────────────────────────────────────────────────
// The "Link prompt to a file" dialog: just the target path.
export const promptLinkFormSchema = z.object({
	path: z.string().min(1, "File path is required"),
});
export type PromptLinkForm = z.infer<typeof promptLinkFormSchema>;

// ─── Add custom agent form ─────────────────────────────────────────────────
// Standalone "Add Custom Agent" dialog. Effort/model are empty-string-or-value
// so the "Default" select option clears them; the caller maps "" → null. No
// `.default()` so the schema's input and output types match (the form seeds
// every field via `values`).
export const addCustomAgentSchema = z.object({
	name: z.string().trim().min(1, "Name is required"),
	binary: runtimeAgentIdSchema,
	model: z.string(),
	effort: z.union([effortLevelSchema, z.literal("")]),
	prompt: z.string().min(50, "Instructions must be at least 50 characters."),
});
export type AddCustomAgentForm = z.infer<typeof addCustomAgentSchema>;
