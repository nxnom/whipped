import { z } from "zod";
import { runtimeGlobalConfigSchema, runtimeProjectSecretSchema, runtimeWorktreeSetupSchema } from "../api-contract.js";

// ─── Global runtime config form ────────────────────────────────────────────────
//
// GeckoUI's RHFNumberInput stores its value as a formatted *string* in form
// state, so the numeric fields are coerced back to numbers on validation/submit.
// Everything else is reused verbatim from the runtime contract.

export const globalConfigFormSchema = runtimeGlobalConfigSchema.extend({
	maxParallelTasks: z.coerce.number().int().positive(),
	maxParallelQA: z.coerce.number().int().positive(),
	maxAutoFixAttempts: z.coerce.number().int().nonnegative(),
	pollingIntervalSeconds: z.coerce.number().int().positive(),
	prPollingIntervalSeconds: z.coerce.number().int().positive(),
});
export type GlobalConfigForm = z.infer<typeof globalConfigFormSchema>;
// Input shape RHF holds (numeric fields are strings before coercion).
export type GlobalConfigFormInput = z.input<typeof globalConfigFormSchema>;

// ─── Environment (worktree setup + start command) form ──────────────────────────
//
// Composed from the runtime worktree-setup schema plus the project-level
// startCommand field. Used by both EnvironmentSection and the worktree portion of
// EnvironmentSecretsSection.

export const environmentFormSchema = runtimeWorktreeSetupSchema.extend({
	startCommand: z.string().default(""),
});
export type EnvironmentForm = z.infer<typeof environmentFormSchema>;
// Input shape RHF holds (fields with defaults are optional before parsing).
export type EnvironmentFormInput = z.input<typeof environmentFormSchema>;

// ─── Secrets form ───────────────────────────────────────────────────────────────
//
// A list of key/value rows, reusing the runtime project-secret schema.

export const secretsFormSchema = z.object({
	secrets: z.array(runtimeProjectSecretSchema).default([]),
});
export type SecretsForm = z.infer<typeof secretsFormSchema>;

// ─── Optional numeric form field ─────────────────────────────────────────────────
//
// RHFNumberInput keeps its value as a *string*; an empty field should clear the
// (optional) config value rather than coerce to 0/NaN.

const optionalNumberField = z.preprocess(
	(v) => (v === "" || v === null || v === undefined ? undefined : v),
	z.coerce.number().int().nonnegative().optional(),
);

// ─── General & Automation form (prop-driven section, no direct API) ───────────────
//
// Mirrors the fields the section edits. Optional numeric overrides fall back to
// the global defaults when left blank.

export const generalAutomationFormSchema = z.object({
	autoCommit: z.boolean().default(true),
	maxParallelTasks: optionalNumberField,
	maxAutoFixAttempts: optionalNumberField,
	pollingIntervalSeconds: optionalNumberField,
	defaultBaseBranch: z.string().optional(),
});
export type GeneralAutomationForm = z.infer<typeof generalAutomationFormSchema>;
// Input shape RHF holds (booleans/numbers are optional/strings before parsing).
export type GeneralAutomationFormInput = z.input<typeof generalAutomationFormSchema>;

// ─── Instructions form (prop-driven section, no direct API) ───────────────────────

export const instructionsFormSchema = z.object({
	systemPrompt: z.string().optional(),
	gitInstructions: z.string().optional(),
});
export type InstructionsForm = z.infer<typeof instructionsFormSchema>;
