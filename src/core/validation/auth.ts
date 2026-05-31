import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 8;

// Request body for /api/auth/login and /api/auth/setup.
export const passwordCredentialsSchema = z.object({
	password: z.string().min(MIN_PASSWORD_LENGTH),
});

// Frontend login form — the server decides correctness, so only require non-empty.
export const loginFormSchema = z.object({
	password: z.string().min(1, "Enter your password"),
});
export type LoginForm = z.infer<typeof loginFormSchema>;

// Frontend first-run form — enforce length and confirmation match client-side.
export const setupFormSchema = z
	.object({
		password: z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`),
		confirmPassword: z.string(),
	})
	.refine((v) => v.password === v.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});
export type SetupForm = z.infer<typeof setupFormSchema>;
