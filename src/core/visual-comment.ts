// Shared renderer for browser-extension visual element references. Used both by
// the review-comment prompt builder and by ticket creation, so a `#N` reference
// reads identically whether it came from a comment or a created task's description.

export interface VisualElementRef {
	elementSelector?: string;
	elementText?: string;
	componentName?: string;
	componentChain?: string[];
	sourceFile?: string;
	sourceLine?: number;
}

/**
 * Render referenced elements as a markdown block. Each line leads with the same
 * `#N` token the user typed in their text, and the list is self-contained, so an
 * agent resolves `#1` against the list directly below it. Returns "" when there's
 * nothing to show.
 */
export function formatVisualElementsBlock(elements: VisualElementRef[], pageUrl?: string): string {
	const lines: string[] = [];
	if (elements.length) {
		lines.push(elements.length > 1 ? "Referenced elements (#N refers to the list below):" : "Referenced element:");
		elements.forEach((el, i) => {
			const bits: string[] = [];
			if (el.elementSelector) bits.push(`\`${el.elementSelector}\``);
			if (Array.isArray(el.componentChain) && el.componentChain.length) {
				bits.push(`🧩 ${el.componentChain.join(" → ")}`);
			} else if (el.componentName) {
				bits.push(`🧩 ${el.componentName}`);
			}
			if (el.sourceFile) bits.push(`${el.sourceFile}${el.sourceLine != null ? `:${el.sourceLine}` : ""}`);
			lines.push(`- #${i + 1} → ${bits.join(" · ")}`);
			if (el.elementText) lines.push(`  "${el.elementText}"`);
		});
	}
	if (pageUrl) lines.push(`Page: ${pageUrl}`);
	return lines.join("\n");
}
