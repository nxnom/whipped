// The tool-usage rules for `whipped_show_canvas` are identical regardless of
// which agent is calling it or what triggered it ("plan" is one trigger phrase
// among several — a set of questions, a report, findings, a UI mockup all
// belong here too) — only the framing sentence differs, so callers prepend
// their own intro before this.
export function buildCanvasModeGuidance(): string {
	return `Call \`whipped_show_canvas\` at most once per turn. Never call it twice in a row before the developer has replied — each call replaces whatever is on their canvas, so a second call before they've looked simply throws the first one away. If you want to reconsider before sending, do that thinking first and make one call with the version you're actually confident in.

The canvas holds exactly one document and keeps no history: pushing a new one replaces the last, and it disappears entirely when this session ends. So each push must stand on its own — carry forward anything from the previous canvas that still matters instead of assuming the developer can look back at it.

Pick the right block type for what you're conveying: markdown for reasoning, steps, findings, and options; an \`html\` block whenever the developer wants to see UI, layout, or visual design — a dashboard, a page structure, a component arrangement. Don't default to describing a layout in prose when they asked to see it — build an actual mockup (divs, flexbox/grid, realistic spacing and colors) so they're looking at an approximation of the real thing, not reading about it. \`html\` blocks are injected into the page at runtime via \`dangerouslySetInnerHTML\` — they are NOT compiled by the app's build-time Tailwind setup, so Tailwind utility classes in that HTML (e.g. \`class="grid grid-cols-3 gap-4"\`) produce no CSS and render unstyled. That's a styling detail, not a reason to avoid html blocks — style mockups with inline \`style="..."\` attributes, or a \`<style>\` block scoped to unique ids/classes you define in that same block's body.

A question can be marked \`required\`, but that's a signal to you, not something the UI enforces — the developer can send feedback (or approve) without answering one, e.g. because they'd rather just leave a comment than pick from options that don't fit. The message you get back states every question explicitly, either with an answer or "(not answered)" — never silently omitted. If a required question comes back "(not answered)" and it's still something you need to know, ask it again in your next canvas rather than assuming it's resolved. And if a comment on a question block says the options don't fit (wrong choices, missing one they want, etc.), revise, add, or remove options in your next canvas accordingly instead of re-asking the same broken question verbatim.

When the developer approves a canvas, it is cleared from their screen and they're returned to the terminal — the approval reaches you as a normal message. Take it as the go-ahead to act, not as a cue to push a confirmation canvas.`;
}
