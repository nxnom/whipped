import { z } from "zod";
import { runtimeCardCreateRequestSchema, runtimeCardPrioritySchema } from "../api-contract.js";

// Priority is optional in the form: an empty string means "no priority". We keep
// the runtime priority enum as the source of truth and widen it with "" so the
// pill toggle can clear the selection. No `.default()` is used anywhere in these
// schemas — the dialog always supplies a complete `values` object to react-hook-
// form, and keeping input/output types identical avoids resolver type drift.
const formPrioritySchema = z.union([runtimeCardPrioritySchema, z.literal("")]);

// Shared config fields that both tasks and subtasks expose in the right sidebar.
// `baseRef` is required (the dialog always resolves a default branch before the
// user can submit); the remaining fields mirror the create request contract.
const sharedConfigShape = {
	priority: formPrioritySchema,
	baseRef: runtimeCardCreateRequestSchema.shape.baseRef.unwrap().min(1, "Base branch is required"),
	workflowId: z.string(),
	branchName: z.string(),
	dependsOn: z.array(z.string()),
};

// A single subtask draft inside the story form. `tempId` keeps the client-side
// identity stable across edits/reorders; `pendingImages` are File objects and
// are validated/handled outside zod, so they are intentionally absent here.
export const subtaskDraftSchema = z.object({
	tempId: z.string(),
	description: z.string().min(1, "Description is required"),
	...sharedConfigShape,
});
export type SubtaskDraftForm = z.infer<typeof subtaskDraftSchema>;

// Task creation: a single card with description + shared config.
export const createTaskFormSchema = z.object({
	description: z.string().min(1, "Description is required"),
	...sharedConfigShape,
});
export type CreateTaskForm = z.infer<typeof createTaskFormSchema>;

// Story creation: an objective (description), a story-level workflow + config,
// and at least one subtask draft.
export const createStoryFormSchema = z.object({
	description: z.string().min(1, "Description is required"),
	priority: formPrioritySchema,
	baseRef: runtimeCardCreateRequestSchema.shape.baseRef.unwrap().min(1, "Base branch is required"),
	workflowId: z.string(),
	subtasks: z.array(subtaskDraftSchema).min(1, "At least one subtask is required"),
});
export type CreateStoryForm = z.infer<typeof createStoryFormSchema>;
