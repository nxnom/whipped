import { ChevronDown, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/utils/classNames";
import type { PlanDocument } from "./types";

export function PlanVersionSelector({
	plans,
	selectedVersion,
	onSelectVersion,
}: {
	plans: PlanDocument[];
	selectedVersion: number;
	onSelectVersion: (version: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const select = (version: number) => {
		onSelectVersion(version);
		setOpen(false);
	};

	if (plans.length <= 1) return null;

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1a1a24] border border-[#2a2a38] hover:border-[#3a3a50] text-gray-400 hover:text-gray-200 text-[11px] transition-colors"
			>
				<FileText size={11} className="text-gray-500" />
				<span>v{selectedVersion}</span>
				<ChevronDown size={10} className="text-gray-600" />
			</button>

			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 bg-[#13131a] border border-[#2a2a38] rounded-lg shadow-2xl min-w-[180px] overflow-hidden py-1">
					{plans.map((p) => (
						<button
							key={p.version}
							onClick={() => select(p.version)}
							className={classNames(
								"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-[#1a1a24] transition-colors",
								selectedVersion === p.version ? "text-gray-100" : "text-gray-400",
							)}
						>
							<span className="font-mono text-purple-400 w-8 shrink-0 text-left">v{p.version}</span>
							<span className="flex-1 text-left truncate">{new Date(p.createdAt).toLocaleTimeString()}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
