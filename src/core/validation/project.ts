import { z } from "zod";

// Form-level schema for the "Add Project" dialog. Pure zod (no React) so it can
// be shared between the web form (react-hook-form resolver) and any non-UI
// callers. Field names mirror the dialog inputs, not the server payload shape;
// the dialog maps these onto `projects.add` { repoPath, initialConfig }.
export const addProjectSchema = z.object({
	repoPath: z.string().min(1, "Repository path is required"),
	deliveryMode: z.enum(["off", "pr", "yolo"]),
	installCommand: z.string().optional(),
});

export type AddProjectInput = z.infer<typeof addProjectSchema>;
