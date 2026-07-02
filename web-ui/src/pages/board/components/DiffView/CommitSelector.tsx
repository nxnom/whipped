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
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-whip-panel-2 border border-whip-border hover:border-whip-border-hover text-whip-muted hover:text-whip-text text-[11px] transition-colors"
			>
				<GitCommit size={11} className="text-whip-muted" />
				{selectedCommitData ? (
					<>
						<span className="font-mono text-[#8b5cf6]">{selectedCommitData.shortHash}</span>
						<span className="text-whip-muted max-w-[120px] truncate">{selectedCommitData.message}</span>
					</>
				) : (
					<span>
						{commits.length} commit{commits.length !== 1 ? "s" : ""}
					</span>
				)}
				<ChevronDown size={10} className="text-whip-faint" />
			</button>

			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 bg-whip-surface border border-whip-border rounded-lg shadow-2xl min-w-[320px] overflow-hidden py-1">
					<button
						onClick={() => select(null)}
						className={classNames(
							"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-whip-panel-2 transition-colors",
							!selectedCommit ? "text-whip-text" : "text-whip-muted",
						)}
					>
						<span className="font-mono text-whip-faint w-14 shrink-0 text-left">All</span>
						<span>Show all changes</span>
					</button>
					<div className="h-px bg-whip-border-soft mx-2 my-1" />
					{commits.map((c) => (
						<button
							key={c.hash}
							onClick={() => select(c.hash)}
							className={classNames(
								"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-whip-panel-2 transition-colors",
								selectedCommit === c.hash ? "text-whip-text" : "text-whip-muted",
							)}
						>
							<span className="font-mono text-[#8b5cf6] w-14 shrink-0 text-left">{c.shortHash}</span>
							<span className="flex-1 text-left truncate">{c.message}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
