import { z } from "zod";
import { memoryScopeSchema, memoryTypeSchema } from "../api-contract.js";

// Form schema for the human-authored memory create/edit dialog. Mirrors the
// fields accepted by POST /api/memory and PATCH /api/memory/:id.
export const memoryFormSchema = z.object({
	type: memoryTypeSchema,
	title: z.string().min(1, "Title is required"),
	content: z.string().min(1, "Content is required"),
	importance: z.number().int().min(1).max(3),
	scope: memoryScopeSchema,
});

export type MemoryFormValues = z.infer<typeof memoryFormSchema>;
