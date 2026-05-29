import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { PromptValue } from "./api-contract.js";
import { logger } from "./logger.js";

// Resolve a slot prompt to the actual text that gets sent to the agent.
// - inline → returns the text as-is
// - file   → reads the file (path is absolute or relative to the workspace
//            repo root). On read failure returns "" and logs; the agent then
//            runs with no system prompt (same behaviour as an empty inline).
export function resolvePromptText(prompt: PromptValue | undefined | null, repoPath: string): string {
	if (!prompt) return "";
	if (prompt.source === "inline") return prompt.text;
	const path = isAbsolute(prompt.path) ? prompt.path : join(repoPath, prompt.path);
	try {
		return readFileSync(path, "utf-8");
	} catch (err) {
		logger.warn({ err: (err as Error).message, path }, "Slot prompt file unreadable — falling back to empty prompt");
		return "";
	}
}
