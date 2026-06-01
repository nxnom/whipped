import { z } from "zod";

// Pure zod schemas for the Slack setup forms. These mirror the inline
// `z.object(...)` bodies in src/api/routes/slack.ts so the frontend (RHF +
// zodResolver) and backend (zv middleware) validate the same shapes.

// POST /api/slack/updateSigningSecret
export const signingSecretSchema = z.object({
	signingSecret: z.string().min(1),
});
export type SigningSecretInput = z.infer<typeof signingSecretSchema>;

// POST /api/slack/createApp
export const createAppSchema = z.object({
	appConfigToken: z.string(),
	publicUrl: z.string(),
	botName: z.string().default("Whipped"),
});
export type CreateAppInput = z.infer<typeof createAppSchema>;
