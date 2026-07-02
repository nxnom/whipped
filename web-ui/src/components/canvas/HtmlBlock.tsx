import { useEffect, useRef } from "react";
import canvasContentCss from "./canvasContent.css?inline";

// Rendered inside a shadow root instead of straight into the page's DOM. The
// agent sends a full mockup document — its own <style> tag, sometimes a whole
// <!DOCTYPE html> wrapper — and a <style> element applies to the entire
// document it's connected to regardless of DOM nesting. Without a shadow
// boundary, one mockup's CSS reset (`* { margin: 0 }`, `body { background }`)
// leaks out and breaks the rest of the app's layout. The shadow root gets its
// own copy of canvasContent.css so images/tables/pre/code still stay inside
// the panel width the same way MarkdownBlock's does.
export function HtmlBlock({ body }: { body: string }) {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
		shadow.innerHTML = `<style>${canvasContentCss}</style><div class="canvas-content">${body}</div>`;
	}, [body]);

	return <div ref={hostRef} className="max-w-full overflow-x-auto text-[13px] leading-relaxed text-whip-text" />;
}
