import type { z } from "zod";
import { runtimeJiraConfigSchema } from "../api-contract.js";

// Reuse the runtime contract shape ({ host, email, token, projectKey }) so the
// Jira config form validates against the exact fields the daemon persists.
export const jiraConfigSchema = runtimeJiraConfigSchema;

export type JiraConfigValues = z.infer<typeof jiraConfigSchema>;
