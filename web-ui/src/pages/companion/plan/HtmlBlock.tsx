// Rendered as-is via dangerouslySetInnerHTML — same trust boundary as the
// markdown block's rehype-raw pass-through (this is the user's own coding
// agent, not untrusted third-party input).
//
// The panel is user-resizable (MIN_WIDTH/MAX_WIDTH in PlanPanel.tsx), and raw
// HTML doesn't go through react-markdown's `components` override system the
// way markdown blocks do, so there's no per-element className hook to make
// content reflow. Instead: constrain the wrapper itself (overflow-x-auto as a
// safety net against anything wider than the panel, e.g. a fixed-width table)
// and use Tailwind's descendant-selector utilities to keep the common
// width-prone elements (images, tables, pre/code, embeds) inside the panel's
// current width rather than blowing out the layout.
export function HtmlBlock({ body }: { body: string }) {
	return (
		<div
			className="max-w-full overflow-x-auto text-[13px] leading-relaxed text-gray-300 break-words [&_img]:max-w-full [&_img]:h-auto [&_video]:max-w-full [&_iframe]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: intentional — agent-authored HTML block, see comment above
			dangerouslySetInnerHTML={{ __html: body }}
		/>
	);
}
