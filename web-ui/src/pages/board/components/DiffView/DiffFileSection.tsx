import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { DiffCommentHandlers } from "./DiffFileList";
import { DiffHunk } from "./DiffHunk";
import { InlineCommentBox } from "./InlineCommentBox";
import { displayPath, fileElemId } from "./parser";
import { PendingCommentBubble } from "./PendingCommentBubble";
import type { DiffFile } from "./types";

// Approximate row heights used to size the placeholder that stands in for a
// file's diff body while it's outside the viewport. Once a body has rendered,
// its real height is measured and reused instead.
const LINE_ROW_HEIGHT = 22;
const HUNK_HEADER_HEIGHT = 23;

function estimateBodyHeight(file: DiffFile): number {
	return file.hunks.reduce((sum, hunk) => sum + HUNK_HEADER_HEIGHT + hunk.lines.length * LINE_ROW_HEIGHT, 0);
}

interface DiffFileSectionProps {
	file: DiffFile;
	scrollRef: React.RefObject<HTMLDivElement>;
	isCollapsed: boolean;
	onToggleCollapse: (path: string) => void;
	comments?: DiffCommentHandlers;
}

export function DiffFileSection({ file, scrollRef, isCollapsed, onToggleCollapse, comments }: DiffFileSectionProps) {
	const path = displayPath(file);
	const sectionRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const measuredHeight = useRef<number | null>(null);
	// Only files near the viewport render their diff lines — offscreen ones keep
	// a fixed-height placeholder so huge diffs stay cheap to mount and re-render.
	const [nearViewport, setNearViewport] = useState(false);

	useEffect(() => {
		const el = sectionRef.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[entries.length - 1];
				if (!entry) return;
				if (!entry.isIntersecting && bodyRef.current) {
					measuredHeight.current = bodyRef.current.offsetHeight;
				}
				setNearViewport(entry.isIntersecting);
			},
			{ root: scrollRef.current, rootMargin: "1200px 0px" },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [scrollRef]);

	const fileCommentKey = `${path}:header`;
	const filePendingComments = comments?.pendingComments.filter((c) => c.file === path) ?? [];
	// Keep the body mounted while one of its comment boxes is open so the
	// textarea (and its focus) survives even if the file leaves the render range.
	const showBody = nearViewport || !!comments?.openCommentKey?.startsWith(`${path}:`);

	return (
		<div ref={sectionRef} id={fileElemId(path)} className="border-b border-whip-border-soft">
			{/* File header */}
			<div className="flex items-center gap-2 px-3 py-2 bg-whip-panel border-b border-whip-border-soft sticky top-0 z-10">
				<button
					onClick={() => onToggleCollapse(path)}
					className="text-whip-faint hover:text-whip-muted shrink-0 transition-colors"
				>
					{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
				</button>
				<span className="flex-1 text-whip-text text-[11px] truncate font-sans">
					{path}
					{file.isNew && (
						<span className="ml-2 text-[10px] text-[#22c55e] bg-[#22c55e]/10 px-1.5 py-0.5 rounded">new file</span>
					)}
					{file.isDeleted && (
						<span className="ml-2 text-[10px] text-[#ff3b4d] bg-[#ff3b4d]/10 px-1.5 py-0.5 rounded">deleted</span>
					)}
				</span>
				{!file.isBinary && (
					<span className="shrink-0 text-[11px] font-sans">
						<span className="text-[#22c55e]">+{file.additions}</span>{" "}
						<span className="text-[#ff3b4d]">-{file.deletions}</span>
					</span>
				)}
				{comments && (
					<button
						onClick={() =>
							comments.openCommentKey === fileCommentKey
								? comments.onCloseComment()
								: comments.onOpenComment(fileCommentKey)
						}
						className="shrink-0 text-whip-faint hover:text-whip-text transition-colors p-0.5 rounded"
						title="Comment on file"
					>
						<MessageSquare size={12} />
					</button>
				)}
			</div>

			{/* File-level comment box */}
			{comments && comments.openCommentKey === fileCommentKey && (
				<InlineCommentBox
					draftRef={comments.draftRef}
					value={comments.commentDraft}
					onChange={comments.onCommentDraftChange}
					onAdd={() => comments.onCommitPending(path, fileCommentKey, null)}
					onCancel={comments.onCloseComment}
				/>
			)}

			{/* File-level pending comments */}
			{comments &&
				filePendingComments
					.filter((c) => c.lineKey === fileCommentKey)
					.map((c) => (
						<PendingCommentBubble
							key={c.id}
							comment={c}
							onSave={comments.onSaveComment}
							onRemove={comments.onRemoveComment}
						/>
					))}

			{/* Hunks — rendered only near the viewport, placeholder otherwise */}
			{!isCollapsed &&
				!file.isBinary &&
				(showBody ? (
					<div ref={bodyRef}>
						{file.hunks.map((hunk, hi) => (
							<DiffHunk key={hi} hunk={hunk} path={path} comments={comments} />
						))}
					</div>
				) : (
					<div style={{ height: measuredHeight.current ?? estimateBodyHeight(file) }} />
				))}

			{!isCollapsed && file.isBinary && (
				<div className="px-4 py-3 text-whip-muted italic font-sans text-xs">Binary file changed</div>
			)}
		</div>
	);
}
