import { ChevronDown, ChevronRight, MessageSquare, Plus } from "lucide-react";
import type React from "react";
import { classNames } from "@/utils/classNames";
import { InlineCommentBox } from "./InlineCommentBox";
import { displayPath, fileElemId } from "./parser";
import { PendingCommentBubble } from "./PendingCommentBubble";
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
		<div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto">
			{files.map((file) => {
				const path = displayPath(file);
				const isCollapsed = collapsed.has(path);
				const fileCommentKey = `${path}:header`;
				const filePendingComments = comments?.pendingComments.filter((c) => c.file === path) ?? [];

				return (
					<div key={path} id={fileElemId(path)} className="border-b border-whip-border-soft">
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
									<span className="ml-2 text-[10px] text-[#22c55e] bg-[#22c55e]/10 px-1.5 py-0.5 rounded">
										new file
									</span>
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

						{/* Hunks */}
						{!isCollapsed &&
							!file.isBinary &&
							file.hunks.map((hunk, hi) => (
								<div key={hi}>
									{/* Hunk header */}
									<div className="px-2 py-0.5 bg-whip-panel-2 text-whip-muted border-y border-whip-border whitespace-pre font-mono text-[11px]">
										{hunk.header}
									</div>

									{/* Lines */}
									{hunk.lines.map((line, li) => {
										const lineNum = line.newNum ?? line.oldNum;
										const lineKey = `${path}:${line.oldNum ?? "-"}:${line.newNum ?? "-"}`;
										const linePending = comments?.pendingComments.filter((c) => c.lineKey === lineKey) ?? [];

										const rowBg =
											line.type === "added" ? "bg-[#22c55e]/10" : line.type === "removed" ? "bg-[#ff3b4d]/10" : "";
										const numBg =
											line.type === "added"
												? "bg-[#22c55e]/20"
												: line.type === "removed"
													? "bg-[#ff3b4d]/20"
													: "bg-transparent";
										const numColor =
											line.type === "added"
												? "text-[#22c55e]"
												: line.type === "removed"
													? "text-[#ff3b4d]"
													: "text-whip-faint";
										const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
										const signColor =
											line.type === "added"
												? "text-[#22c55e]"
												: line.type === "removed"
													? "text-[#ff3b4d]"
													: "text-transparent";
										const textColor =
											line.type === "added"
												? "text-[#86efac]"
												: line.type === "removed"
													? "text-[#fca5a5]"
													: "text-whip-muted";

										return (
											<div key={li}>
												{/* Line row */}
												<div
													className={classNames("group relative flex hover:brightness-110 transition-[filter]", rowBg)}
												>
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
														className={classNames("flex-1 py-0.5 pr-7 whitespace-pre font-mono text-[12px]", textColor)}
													>
														{line.content}
													</div>
													{/* Hover comment button */}
													{comments && (
														<button
															onClick={() =>
																comments.openCommentKey === lineKey
																	? comments.onCloseComment()
																	: comments.onOpenComment(lineKey)
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
							))}

						{!isCollapsed && file.isBinary && (
							<div className="px-4 py-3 text-whip-muted italic font-sans text-xs">Binary file changed</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
