import { Plus } from "lucide-react";
import { classNames } from "@/utils/classNames";
import type { DiffCommentHandlers } from "./DiffFileList";
import { InlineCommentBox } from "./InlineCommentBox";
import { PendingCommentBubble } from "./PendingCommentBubble";
import type { DiffHunk as DiffHunkData } from "./types";

interface DiffHunkProps {
	hunk: DiffHunkData;
	path: string;
	comments?: DiffCommentHandlers;
}

export function DiffHunk({ hunk, path, comments }: DiffHunkProps) {
	return (
		<div>
			{/* Hunk header */}
			<div className="px-2 py-0.5 bg-whip-panel-2 text-whip-muted border-y border-whip-border whitespace-pre-wrap break-words font-mono text-[11px]">
				{hunk.header}
			</div>

			{/* Lines */}
			{hunk.lines.map((line, li) => {
				const lineNum = line.newNum ?? line.oldNum;
				const lineKey = `${path}:${line.oldNum ?? "-"}:${line.newNum ?? "-"}`;
				const linePending = comments?.pendingComments.filter((c) => c.lineKey === lineKey) ?? [];

				const rowBg = line.type === "added" ? "bg-[#22c55e]/10" : line.type === "removed" ? "bg-[#ff3b4d]/10" : "";
				const numBg =
					line.type === "added" ? "bg-[#22c55e]/20" : line.type === "removed" ? "bg-[#ff3b4d]/20" : "bg-transparent";
				const numColor =
					line.type === "added" ? "text-[#22c55e]" : line.type === "removed" ? "text-[#ff3b4d]" : "text-whip-faint";
				const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
				const signColor =
					line.type === "added" ? "text-[#22c55e]" : line.type === "removed" ? "text-[#ff3b4d]" : "text-transparent";
				const textColor =
					line.type === "added" ? "text-[#86efac]" : line.type === "removed" ? "text-[#fca5a5]" : "text-whip-muted";

				return (
					<div key={li}>
						{/* Line row */}
						<div className={classNames("group relative flex hover:brightness-110 transition-[filter]", rowBg)}>
							{/* Line number */}
							<div
								className={classNames(
									"w-10 shrink-0 text-right pr-2 py-0.5 select-none border-r border-whip-border-soft font-mono text-[11px]",
									numBg,
									numColor,
								)}
							>
								{line.newNum ?? line.oldNum ?? ""}
							</div>
							{/* Sign */}
							<div className="w-5 shrink-0 text-center py-0.5 select-none">
								<span className={classNames("font-mono", signColor)}>{sign}</span>
							</div>
							<div
								className={classNames(
									"flex-1 min-w-0 py-0.5 pr-7 whitespace-pre-wrap break-words font-mono text-[12px]",
									textColor,
								)}
							>
								{line.content}
							</div>
							{/* Hover comment button */}
							{comments && (
								<button
									onClick={() =>
										comments.openCommentKey === lineKey ? comments.onCloseComment() : comments.onOpenComment(lineKey)
									}
									className="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-whip-text hover:text-white p-0.5 rounded bg-whip-panel-2"
								>
									<Plus size={11} />
								</button>
							)}
						</div>

						{/* Inline comment box */}
						{comments && comments.openCommentKey === lineKey && (
							<InlineCommentBox
								draftRef={comments.draftRef}
								value={comments.commentDraft}
								onChange={comments.onCommentDraftChange}
								onAdd={() => comments.onCommitPending(path, lineKey, lineNum)}
								onCancel={comments.onCloseComment}
							/>
						)}

						{/* Pending comments on this line */}
						{comments &&
							linePending.map((c) => (
								<PendingCommentBubble
									key={c.id}
									comment={c}
									onSave={comments.onSaveComment}
									onRemove={comments.onRemoveComment}
								/>
							))}
					</div>
				);
			})}
		</div>
	);
}
