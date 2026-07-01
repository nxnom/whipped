import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { classNames } from "@/utils/classNames";
import type { TreeNode } from "./types";

export function FileTreeNode({
	node,
	depth,
	collapsedDirs,
	onToggleDir,
	onFileClick,
}: {
	node: TreeNode;
	depth: number;
	collapsedDirs: Set<string>;
	onToggleDir: (path: string) => void;
	onFileClick: (path: string) => void;
}) {
	if (node.isFile) {
		const additions = node.file?.additions ?? 0;
		const deletions = node.file?.deletions ?? 0;
		const isNew = node.file?.isNew ?? false;
		const isDeleted = node.file?.isDeleted ?? false;
		return (
			<button
				onClick={() => onFileClick(node.fullPath)}
				title={node.fullPath}
				className="flex items-center gap-2 w-full text-left py-1 hover:bg-[#161616] rounded text-[14px] text-[#8a8f98] hover:text-[#ededed] font-sans transition-colors"
				style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8 }}
			>
				<File
					size={13}
					className={classNames("shrink-0", isNew ? "text-[#22c55e]" : isDeleted ? "text-[#ff3b4d]" : "text-[#5f6672]")}
				/>
				<span className="flex-1 truncate min-w-0">{node.name}</span>
				{isNew && (
					<span className="shrink-0 text-[10px] font-medium text-[#22c55e] bg-[#22c55e]/10 px-1 rounded">new</span>
				)}
				{isDeleted && (
					<span className="shrink-0 text-[10px] font-medium text-[#ff3b4d] bg-[#ff3b4d]/10 px-1 rounded">del</span>
				)}
				{!isNew && !isDeleted && (
					<span className="shrink-0 font-mono text-[11px]">
						{additions > 0 && <span className="text-[#22c55e]">+{additions}</span>}
						{deletions > 0 && (
							<span className="text-[#ff3b4d]">
								{additions > 0 ? " " : ""}-{deletions}
							</span>
						)}
					</span>
				)}
				{isNew && additions > 0 && <span className="shrink-0 font-mono text-[11px] text-[#22c55e]">+{additions}</span>}
				{isDeleted && deletions > 0 && (
					<span className="shrink-0 font-mono text-[11px] text-[#ff3b4d]">-{deletions}</span>
				)}
			</button>
		);
	}

	const isCollapsed = collapsedDirs.has(node.fullPath);
	return (
		<div>
			{node.name && (
				<button
					onClick={() => onToggleDir(node.fullPath)}
					className="flex items-center gap-1.5 w-full text-left py-1 hover:bg-[#161616] rounded text-[14px] text-[#8a8f98] hover:text-[#8a8f98] font-sans transition-colors"
					style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8 }}
				>
					{isCollapsed ? (
						<ChevronRight size={13} className="shrink-0 text-[#5f6672]" />
					) : (
						<ChevronDown size={13} className="shrink-0 text-[#5f6672]" />
					)}
					{isCollapsed ? (
						<Folder size={13} className="shrink-0 text-[#eab308]/60 ml-0.5" />
					) : (
						<FolderOpen size={13} className="shrink-0 text-[#eab308]/60 ml-0.5" />
					)}
					<span className="ml-0.5">{node.name}</span>
				</button>
			)}
			{!isCollapsed &&
				node.children.map((child) => (
					<FileTreeNode
						key={child.fullPath}
						node={child}
						depth={node.name ? depth + 1 : depth}
						collapsedDirs={collapsedDirs}
						onToggleDir={onToggleDir}
						onFileClick={onFileClick}
					/>
				))}
		</div>
	);
}
