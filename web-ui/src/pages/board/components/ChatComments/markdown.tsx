import type React from "react";
import type ReactMarkdown from "react-markdown";

// Minimal hast shape we touch — avoids pulling in @types/hast.
interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

// Rehype plugin: wrap `#N` element references in a colour chip (matching the
// element's badge), skipping code/pre. `colorOf` returns a colour for a valid
// reference number or undefined to leave it untouched.
export function refHighlightRehype(colorOf: (n: number) => string | undefined) {
	const walk = (node: HastNode) => {
		if (!node.children) return;
		if (node.type === "element" && (node.tagName === "code" || node.tagName === "pre")) return;
		const out: HastNode[] = [];
		for (const child of node.children) {
			if (child.type === "text" && child.value) {
				const parts = child.value.split(/(#\d+)/g);
				if (parts.length === 1) {
					out.push(child);
					continue;
				}
				for (const part of parts) {
					const m = /^#(\d+)$/.exec(part);
					const color = m ? colorOf(Number(m[1])) : undefined;
					if (m && color) {
						out.push({
							type: "element",
							tagName: "mark",
							properties: {
								style: `background:${color};color:#0c0c0f;border-radius:3px;padding:0 3px;font-weight:600`,
							},
							children: [{ type: "text", value: part }],
						});
					} else if (part) {
						out.push({ type: "text", value: part });
					}
				}
			} else {
				walk(child);
				out.push(child);
			}
		}
		node.children = out;
	};
	return (tree: HastNode) => walk(tree);
}

// Dark-theme markdown renderers shared by every comment body.
export function makeMdComponents(): React.ComponentProps<typeof ReactMarkdown>["components"] {
	return {
		p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
		strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
		em: ({ children }) => <em className="italic">{children}</em>,
		code: ({ children, className }) => {
			const isBlock = className?.includes("language-");
			return isBlock ? (
				<code className="block bg-[#1a1a24] border border-[#2a2a38] rounded px-3 py-2 text-xs font-mono text-gray-200 overflow-x-auto whitespace-pre my-1">
					{children}
				</code>
			) : (
				<code className="bg-[#1a1a24] border border-[#2a2a38] rounded px-1 py-0.5 text-xs font-mono text-gray-200">
					{children}
				</code>
			);
		},
		pre: ({ children }) => <pre className="my-1 overflow-x-auto">{children}</pre>,
		ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
		ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
		li: ({ children }) => <li className="text-gray-300">{children}</li>,
		blockquote: ({ children }) => (
			<blockquote className="border-l-2 border-[#3a3a50] pl-3 my-1 text-gray-400 italic">{children}</blockquote>
		),
		a: ({ href, children }) => (
			<a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
				{children}
			</a>
		),
		h1: ({ children }) => <h1 className="text-base font-semibold text-gray-100 mt-2 mb-1">{children}</h1>,
		h2: ({ children }) => <h2 className="text-sm font-semibold text-gray-100 mt-2 mb-1">{children}</h2>,
		h3: ({ children }) => <h3 className="text-sm font-medium text-gray-200 mt-1 mb-0.5">{children}</h3>,
		hr: () => <hr className="border-[#2a2a38] my-2" />,
		img: ({ src, alt }) => <img src={src} alt={alt} className="max-w-full max-h-64 rounded my-1 object-contain" />,
	};
}
