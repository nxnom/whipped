import type React from "react";
import { DiffFileSection } from "./DiffFileSection";
import { displayPath } from "./parser";
import type { DiffFile, PendingComment } from "./types";

// Inline-commenting affordances only make sense where there's a review
// workflow to attach comments to (ticket diffs) — omit this bundle entirely
// (e.g. for a companion session's diff) and DiffFileList renders read-only.
export interface DiffCommentHandlers {
	draftRef: React.RefObject<HTMLTextAreaElement>;
	openCommentKey: string | null;
	onOpenComment: (key: string) => void;
	onCloseComment: () => void;
	commentDraft: string;
	onCommentDraftChange: (v: string) => void;
	onCommitPending: (file: string, lineKey: string, lineNum: number | null) => void;
	pendingComments: PendingComment[];
	onSaveComment: (id: string) => void;
	onRemoveComment: (id: string) => void;
}

interface DiffFileListProps {
	files: DiffFile[];
	scrollRef: React.RefObject<HTMLDivElement>;
	collapsed: Set<string>;
	onToggleCollapse: (path: string) => void;
	comments?: DiffCommentHandlers;
}

export function DiffFileList({ files, scrollRef, collapsed, onToggleCollapse, comments }: DiffFileListProps) {
	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			{files.map((file) => {
				const path = displayPath(file);
				return (
					<DiffFileSection
						key={path}
						file={file}
						scrollRef={scrollRef}
						isCollapsed={collapsed.has(path)}
						onToggleCollapse={onToggleCollapse}
						comments={comments}
					/>
				);
			})}
		</div>
	);
}
