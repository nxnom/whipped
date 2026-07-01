import type { CanvasBlock } from "../core/api-contract.js";

// Renders canvas blocks into plain text for a system prompt. The canvas is
// push-only (agent -> human, via whipped_show_canvas) — there's no tool for
// the agent to read it back, so this is the only way a resumed session's
// agent ever learns what a saved canvas actually contains.
export function serializeCanvasBlocksForPrompt(blocks: CanvasBlock[]): string {
	return blocks
		.map((block) => {
			if (block.type === "markdown") return block.body;
			if (block.type === "html") return `\`\`\`html\n${block.body}\n\`\`\``;
			if (block.type === "diagram") return `\`\`\`mermaid\n${block.source}\n\`\`\``;
			const input = block.input;
			const options =
				input.kind === "single_choice" || input.kind === "multi_choice"
					? `\nOptions: ${input.options.map((o) => o.label).join(", ")}`
					: "";
			return `Q: ${block.prompt}${options}`;
		})
		.join("\n\n");
}

// The tool-usage rules for whipped_show_canvas / whipped_save_canvas are
// identical regardless of which agent is calling them or what triggered it
// ("plan" is one trigger phrase among several — a set of questions, a report,
// findings, a UI mockup all belong here too) — only the framing sentence
// differs, so callers prepend their own intro before this.
export function buildCanvasModeGuidance(): string {
	return `Call \`whipped_show_canvas\` at most once per turn. Never call it twice in a row before the developer has replied — each call appends a new version to their canvas, so back-to-back calls show up as clutter, not a revision. If you want to reconsider before sending, do that thinking first and make one call with the version you're actually confident in.

Pick the right block type for what you're conveying: markdown for reasoning, steps, findings, and options; an \`html\` block whenever the developer wants to see UI, layout, or visual design — a dashboard, a page structure, a component arrangement. Don't default to describing a layout in prose when they asked to see it — build an actual mockup (divs, flexbox/grid, realistic spacing and colors) so they're looking at an approximation of the real thing, not reading about it. \`html\` blocks are injected into the page at runtime via \`dangerouslySetInnerHTML\` — they are NOT compiled by the app's build-time Tailwind setup, so Tailwind utility classes in that HTML (e.g. \`class="grid grid-cols-3 gap-4"\`) produce no CSS and render unstyled. That's a styling detail, not a reason to avoid html blocks — style mockups with inline \`style="..."\` attributes, or a \`<style>\` block scoped to unique ids/classes you define in that same block's body.

A question can be marked \`required\`, but that's a signal to you, not something the UI enforces — the developer can send feedback (or approve) without answering one, e.g. because they'd rather just leave a comment than pick from options that don't fit. The message you get back states every question explicitly, either with an answer or "(not answered)" — never silently omitted. If a required question comes back "(not answered)" and it's still something you need to know, ask it again in your next canvas version rather than assuming it's resolved. And if a comment on a question block says the options don't fit (wrong choices, missing one they want, etc.), revise, add, or remove options in your next version accordingly instead of re-asking the same broken question verbatim.

When the developer approves a canvas, they'll be offered the option to save it to the project's reusable canvas library. If they do, you'll be asked to consolidate everything proposed across every version pushed in this session into ONE final, coherent canvas and save it via the \`whipped_save_canvas\` tool. Beyond that one prompted moment, also call \`whipped_save_canvas\` proactively whenever you finish a meaningful chunk of work — describe what's done explicitly in the blocks (not just what's left), so that if this session's canvas is ever resumed later, its state accurately reflects progress. If this session already has a saved canvas (you resumed from one, or already saved once), calling the tool again updates that same canvas in place rather than creating a duplicate — you don't need to track which case applies, the tool handles it.`;
}
