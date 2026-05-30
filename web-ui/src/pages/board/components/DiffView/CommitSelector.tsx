import { ChevronDown, GitCommit } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/utils/classNames";
import type { DiffCommit } from "./useDiffData";

interface CommitSelectorProps {
	commits: DiffCommit[];
	selectedCommit: string | null;
	onSelectCommit: (hash: string | null) => void;
}

export function CommitSelector({ commits, selectedCommit, onSelectCommit }: CommitSelectorProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const selectedCommitData = commits.find((c) => c.hash === selectedCommit);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const select = (hash: string | null) => {
		onSelectCommit(hash);
		setOpen(false);
	};

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1a1a24] border border-[#2a2a38] hover:border-[#3a3a50] text-gray-400 hover:text-gray-200 text-[11px] transition-colors"
			>
				<GitCommit size={11} className="text-gray-500" />
				{selectedCommitData ? (
					<>
						<span className="font-mono text-purple-400">{selectedCommitData.shortHash}</span>
						<span className="text-gray-500 max-w-[120px] truncate">{selectedCommitData.message}</span>
					</>
				) : (
					<span>
						{commits.length} commit{commits.length !== 1 ? "s" : ""}
					</span>
				)}
				<ChevronDown size={10} className="text-gray-600" />
			</button>

			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 bg-[#13131a] border border-[#2a2a38] rounded-lg shadow-2xl min-w-[320px] overflow-hidden py-1">
					<button
						onClick={() => select(null)}
						className={classNames(
							"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-[#1a1a24] transition-colors",
							!selectedCommit ? "text-gray-100" : "text-gray-500",
						)}
					>
						<span className="font-mono text-gray-600 w-14 shrink-0 text-left">All</span>
						<span>Show all changes</span>
					</button>
					<div className="h-px bg-[#1e1e28] mx-2 my-1" />
					{commits.map((c) => (
						<button
							key={c.hash}
							onClick={() => select(c.hash)}
							className={classNames(
								"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-[#1a1a24] transition-colors",
								selectedCommit === c.hash ? "text-gray-100" : "text-gray-400",
							)}
						>
							<span className="font-mono text-purple-400 w-14 shrink-0 text-left">{c.shortHash}</span>
							<span className="flex-1 text-left truncate">{c.message}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
