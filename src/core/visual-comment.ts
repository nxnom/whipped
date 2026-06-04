// Shared renderer for browser-extension visual element references. Used both by
// the review-comment prompt builder and by ticket creation, so a `#N` reference
// reads identically whether it came from a comment or a created task's description.
// Output mirrors the extension's copied prompt: a fenced YAML block.

export interface VisualElementRef {
	elementSelector?: string;
	elementText?: string;
	componentName?: string;
	componentChain?: string[];
	sourceFile?: string;
	sourceLine?: number;
	pageUrl?: string;
}

function yamlQuote(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Bare scalar when it's safe; quote when it could confuse a YAML parser.
function yamlScalar(v: string): string {
	const risky = v === "" || /^\s|\s$/.test(v) || /: /.test(v) || / #/.test(v) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(v);
	return risky ? yamlQuote(v) : v;
}

/**
 * Render referenced elements as a fenced YAML block. Each entry's `ref: N`
 * matches the `#N` token the user typed, so an agent resolves `#1` against the
 * list directly below it. Elements can span pages: a single shared page is
 * hoisted to a top-level `page:`, otherwise each element carries its own `url:`.
 * Returns "" when there's nothing to show.
 */
export function formatVisualElementsBlock(elements: VisualElementRef[], pageUrl?: string): string {
	if (!elements.length) return pageUrl ? `Page: ${pageUrl}` : "";

	const elementUrls = elements.map((e) => e.pageUrl).filter((u): u is string => !!u);
	const urls = elementUrls.length ? elementUrls : pageUrl ? [pageUrl] : [];
	const uniqueUrls = [...new Set(urls)];
	const singlePage = uniqueUrls.length === 1;

	const yaml: string[] = [];
	if (singlePage) yaml.push(`page: ${yamlScalar(uniqueUrls[0]!)}`);
	yaml.push("elements:");
	elements.forEach((el, i) => {
		const chain = el.componentChain?.length ? el.componentChain.join(" → ") : el.componentName;
		const src = el.sourceFile ? `${el.sourceFile}${el.sourceLine != null ? `:${el.sourceLine}` : ""}` : null;
		const url = el.pageUrl ?? (elementUrls.length ? undefined : pageUrl);
		yaml.push(`  - ref: ${i + 1}`);
		if (chain) yaml.push(`    component: ${yamlScalar(chain)}`);
		if (el.elementText) yaml.push(`    text: ${yamlQuote(el.elementText)}`);
		if (src) yaml.push(`    source: ${yamlScalar(src)}`);
		if (!singlePage && url) yaml.push(`    url: ${yamlScalar(url)}`);
		if (el.elementSelector) yaml.push(`    selector: ${yamlQuote(el.elementSelector)}`);
	});

	const intro = "Referenced elements (`#N` in the text maps to `ref: N` below):";
	return `${intro}\n\`\`\`yaml\n${yaml.join("\n")}\n\`\`\``;
}
