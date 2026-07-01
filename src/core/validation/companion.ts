import { z } from "zod";

export const companionStartFormSchema = z
	.object({
		useWorktree: z.boolean(),
		baseRef: z.string().min(1, "Base branch is required"),
		branchName: z.string(),
		workflowId: z.string(),
	})
	.superRefine((v, ctx) => {
		if (v.useWorktree && !v.branchName.trim()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Branch name is required", path: ["branchName"] });
		}
	});
export type CompanionStartForm = z.infer<typeof companionStartFormSchema>;
