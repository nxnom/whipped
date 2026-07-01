import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

let mermaidInitialized = false;

export function MermaidBlock({ id, source, caption }: { id: string; source: string; caption?: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		const render = async () => {
			try {
				const { default: mermaid } = await import("mermaid");
				if (!mermaidInitialized) {
					mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
					mermaidInitialized = true;
				}
				const { svg } = await mermaid.render(`mermaid-${id}`, source);
				if (!cancelled && containerRef.current) {
					containerRef.current.innerHTML = svg;
					setError(null);
				}
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render diagram");
			}
		};

		void render();
		return () => {
			cancelled = true;
		};
	}, [id, source]);

	if (error) {
		return (
			<div className="flex flex-col gap-2 rounded-lg border border-[#ff3b4d]/40 bg-[#ff3b4d]/20 p-3">
				<div className="flex items-center gap-1.5 text-[11px] text-[#ff3b4d]">
					<AlertTriangle size={12} />
					Failed to render diagram: {error}
				</div>
				<pre className="overflow-x-auto whitespace-pre text-[11px] font-mono text-[#8a8f98]">{source}</pre>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div ref={containerRef} className="overflow-x-auto rounded-lg bg-[#111111] p-3" />
			{caption && <span className="text-[11px] text-[#8a8f98] text-center">{caption}</span>}
		</div>
	);
}
