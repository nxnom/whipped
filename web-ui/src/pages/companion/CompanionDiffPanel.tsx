import { AlertTriangle, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { CommitSelector } from "../board/components/DiffView/CommitSelector";
import { FileTreeNode } from "../board/components/DiffView/FileTreeNode";
import { buildFileTree } from "../board/components/DiffView/parser";
import { CompanionDiffFileList } from "./CompanionDiffFileList";
import { useCompanionDiffData } from "./useCompanionDiffData";

export function CompanionDiffPanel({ sessionId }: { sessionId: string }) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const diffScrollRef = useRef<HTMLDivElement>(null);

	const { selectedCommit, setSelectedCommit, files, loading, loadError, commits, baseBehindCount, refreshDiff } =
		useCompanionDiffData(sessionId);

	const toggleCollapse = (path: string) =>
		setCollapsed((prev) => {
			const n = new Set(prev);
			n.has(path) ? n.delete(path) : n.add(path);
			return n;
		});

	const toggleDir = (path: string) =>
		setCollapsedDirs((prev) => {
			const n = new Set(prev);
			n.has(path) ? n.delete(path) : n.add(path);
			return n;
		});

	const scrollToFile = (path: string) => {
		const el = document.getElementById(`diff-file-${path.replace(/[^a-z0-9]/gi, "_")}`);
		const container = diffScrollRef.current;
		if (!el || !container) return;
		const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
		container.scrollTo({ top: top - 4, behavior: "smooth" });
	};

	if (loading) {
		return <div className="flex-1 flex items-center justify-center text-[#8a8f98] text-sm">Loading diff…</div>;
	}

	if (loadError) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#8a8f98]">
				<p className="text-sm">{loadError}</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-[#ededed] hover:text-white">
					<RefreshCw size={12} /> Retry
				</button>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#8a8f98]">
				<p className="text-sm">No changes yet</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-[#ededed] hover:text-white">
					<RefreshCw size={12} /> Refresh
				</button>
			</div>
		);
	}

	const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
	const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
	const fileTree = buildFileTree(files);

	return (
		<div className="flex-1 min-h-0 flex flex-col font-mono text-xs bg-whip-bg">
			<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#1f1f1f] bg-[#111111] font-sans">
				<span className="text-[#8a8f98] text-xs">
					{files.length} file{files.length !== 1 ? "s" : ""}
					{" · "}
					<span className="text-[#22c55e]">+{totalAdditions}</span>{" "}
					<span className="text-[#ff3b4d]">-{totalDeletions}</span>
				</span>
				{commits.length > 0 && (
					<CommitSelector commits={commits} selectedCommit={selectedCommit} onSelectCommit={setSelectedCommit} />
				)}
				<div className="flex-1" />
				<button
					onClick={refreshDiff}
					className="text-[#5f6672] hover:text-[#ededed] transition-colors p-1 rounded hover:bg-[#1f1f1f]"
					title="Refresh diff"
				>
					<RefreshCw size={13} />
				</button>
			</div>

			{baseBehindCount > 0 && !selectedCommit && (
				<div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#eab308]/10 border-b border-[#eab308]/30 font-sans">
					<AlertTriangle size={12} className="text-[#eab308] shrink-0" />
					<span className="text-[#eab308]/90 text-xs">
						Base branch has {baseBehindCount} new commit{baseBehindCount !== 1 ? "s" : ""} not yet in this branch.
					</span>
				</div>
			)}

			<div className="flex flex-1 min-h-0">
				<div className="shrink-0 w-[208px] border-r border-[#1f1f1f] overflow-y-auto bg-[#111111] py-2">
					<FileTreeNode
						node={fileTree}
						depth={0}
						collapsedDirs={collapsedDirs}
						onToggleDir={toggleDir}
						onFileClick={scrollToFile}
					/>
				</div>
				<CompanionDiffFileList
					files={files}
					scrollRef={diffScrollRef}
					collapsed={collapsed}
					onToggleCollapse={toggleCollapse}
				/>
			</div>
		</div>
	);
}
