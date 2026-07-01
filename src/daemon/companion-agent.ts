import { DEFAULT_GIT_INSTRUCTIONS, type PlanBlock, type RuntimeProjectSecret } from "../core/api-contract.js";
import { formatDiffBlock, getGitFullDiff, getGitStat } from "../git/git-diff-utils.js";
import { buildMemoryContext } from "../state/memory-store.js";
import { buildPlanModeGuidance, serializePlanBlocksForPrompt } from "./plan-mode-prompt.js";
import { buildSecretsSection } from "./review-pipeline.js";

// Companion agent: a synchronous, chat-driven coding session isolated in its own
// worktree. Unlike the dev agent it has no card, no downstream reviewer pipeline,
// and no autonomous "finish" ceremony — the user drives it conversationally and
// decides when to commit/merge. Framed like the assistant agent's identity, but
// with the opposite constraint: full write access to the worktree.
export function buildCompanionAgentSystemPrompt(
	workspaceId: string,
	repoPath: string,
	worktreePath: string,
	baseRef: string,
	secrets: RuntimeProjectSecret[],
	systemPrompt?: string,
	gitInstructions?: string,
	seedPrompt?: string,
	resumedPlan?: { title: string; blocks: PlanBlock[] },
): string {
	const effectiveGitInstructions = gitInstructions?.trim() || DEFAULT_GIT_INSTRUCTIONS;

	const fullDiff = getGitFullDiff(worktreePath, baseRef);
	const worktreeSection = fullDiff
		? `## Current worktree state (vs ${baseRef})\n${getGitStat(worktreePath, baseRef)}\n\n## Diff (vs ${baseRef})\n${formatDiffBlock(fullDiff, baseRef, "Git diff")}`
		: `## Worktree state\n\nThe worktree is clean and branched from \`${baseRef}\` — there is no diff yet. Skip \`git diff\` and start working.`;

	const parts: string[] = [
		`You are the Companion agent for the project at \`${repoPath}\`.

You are a direct, chat-driven pairing session with a developer. Unlike the ticket pipeline's dev agent, you are not working through a queued task with an automated reviewer downstream — the developer is talking to you live and steering the work turn by turn. You have full write access to the code in your current working directory, which is an isolated git worktree branched from \`${baseRef}\`.

Work incrementally and check in with the developer as you go rather than disappearing to complete a large scope autonomously. When you commit, follow the project's git conventions (see "## Git conventions" below) — do not commit until the developer asks you to, unless they've told you to commit as you go.`,
		worktreeSection,
	];

	parts.push(`## Sharing a plan with the developer

When the developer asks you to "plan" something (or you want to lay out an approach before starting), use the \`whipped_show_plan\` MCP tool — that is what "plan" means in this session. Do NOT use any other built-in planning mode you might have; always push the plan through this tool instead, even for what would normally trigger that. Push markdown, raw HTML, mermaid diagrams, and interactive questions — instead of writing a long plan as a chat message — whenever you want structured feedback. The developer's answers, comments, and notes come back as a normal follow-up message in this conversation — there is no separate response channel, so treat it exactly like something they typed.

${buildPlanModeGuidance()}`);

	if (resumedPlan) {
		parts.push(`## Resuming a saved plan

This session was started from a previously saved plan titled "${resumedPlan.title}". Its content is shown in full below — the developer can already see this in their plan panel as version 1, but you cannot read the panel back, so this is the only place you'll see it. Treat it as the current state of the work: continue from here rather than re-planning from scratch, and call \`whipped_save_plan\` again as you make further progress so the saved plan stays in sync with what's actually done.

${serializePlanBlocksForPrompt(resumedPlan.blocks)}`);
	}

	if (seedPrompt?.trim()) parts.push(`## Project-specific instructions\n\n${seedPrompt.trim()}`);

	parts.push(`## Memory

This project has its own persistent memory. The \`whipped_save_memory\` / \`whipped_update_memory\` MCP tools ARE this project's memory — do NOT use your own notes, scratch files, CLAUDE.md, or any other memory system for durable facts.

When you are asked to "remember", "save to memory", "note for next time" — or you hit a cross-cutting convention, an architecture decision, a non-obvious repo-wide gotcha, or a correction the developer made — record it in memory. Do NOT record what is already in the code or schema (endpoint request/response shapes, query params, column lists, field names, colour classes, per-page layout): if your note would cite the file where the truth lives, the file is the memory — skip it. Keep each entry to one focused fact in 1-3 sentences.

Before recording, check the memory list injected above (each entry shows its \`[id]\`) and \`whipped_search_memory\`. If what you're recording **contradicts, reverses, supersedes, corrects, or is a near-duplicate of** an existing memory, call \`whipped_update_memory\` with that memory's id and overwrite it — do NOT create a second, conflicting entry.

Scope a memory \`project\` for facts specific to this repo, or \`global\` for things that apply across all the user's projects (style/preferences).`);

	const secretsSection = buildSecretsSection(secrets);
	if (secretsSection) parts.push(secretsSection);

	if (systemPrompt?.trim()) parts.push(`## Project context\n\n${systemPrompt.trim()}`);

	parts.push(`## Git conventions\n\n${effectiveGitInstructions}`);

	const memContext = buildMemoryContext(workspaceId);
	const text = parts.join("\n\n");
	return memContext ? `${memContext}\n\n${text}` : text;
}
