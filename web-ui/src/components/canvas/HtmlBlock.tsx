import "./canvasContent.css";

// Rendered as-is via dangerouslySetInnerHTML — same trust boundary as the
// markdown block's rehype-raw pass-through (this is the user's own coding
// agent, not untrusted third-party input).
//
// The panel is user-resizable (MIN_WIDTH/MAX_WIDTH in CanvasPanel.tsx), and raw
// HTML doesn't go through react-markdown's `components` override system the
// way markdown blocks do, so there's no per-element className hook to make
// content reflow. The `canvas-content` class (canvasContent.css, shared with
// MarkdownBlock) keeps the common width-prone elements (images, tables,
// pre/code, embeds) inside the panel's current width via plain descendant
// selectors, rather than a page's worth of Tailwind `[&_x]:` arbitrary
// variants living in this className string.
export function HtmlBlock({ body }: { body: string }) {
	return (
		<div
			className="canvas-content overflow-x-auto text-[13px] leading-relaxed text-whip-text break-words"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: intentional — agent-authored HTML block, see comment above
			dangerouslySetInnerHTML={{ __html: body }}
		/>
	);
}
