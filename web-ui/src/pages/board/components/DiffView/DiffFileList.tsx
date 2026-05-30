import { ChevronDown, ChevronRight, MessageSquare, Plus } from "lucide-react";
import type React from "react";
import { classNames } from "@/utils/classNames";
import { InlineCommentBox } from "./InlineCommentBox";
import { displayPath, fileElemId } from "./parser";
import { PendingCommentBubble } from "./PendingCommentBubble";
import type { DiffFile, PendingComment } from "./types";

interface DiffFileListProps {
	files: DiffFile[];
	scrollRef: React.RefObject<HTMLDivElement>;
	draftRef: React.RefObject<HTMLTextAreaElement>;
	collapsed: Set<string>;
	onToggleCollapse: (path: string) => void;
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

export function DiffFileList({
	files,
	scrollRef,
	draftRef,
	collapsed,
	onToggleCollapse,
	openCommentKey,
	onOpenComment,
	onCloseComment,
	commentDraft,
	onCommentDraftChange,
	onCommitPending,
	pendingComments,
	onSaveComment,
	onRemoveComment,
}: DiffFileListProps) {
	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto">
			{files.map((file) => {
				const path = displayPath(file);
				const isCollapsed = collapsed.has(path);
				const fileCommentKey = `${path}:header`;
				const filePendingComments = pendingComments.filter((c) => c.file === path);

				return (
					<div key={path} id={fileElemId(path)} className="border-b border-[#1e1e28]">
						{/* File header */}
						<div className="flex items-center gap-2 px-3 py-2 bg-[#111118] border-b border-[#1e1e28] sticky top-0 z-10">
							<button
								onClick={() => onToggleCollapse(path)}
								className="text-gray-600 hover:text-gray-400 shrink-0 transition-colors"
							>
								{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
							</button>
							<span className="flex-1 text-gray-300 text-[11px] truncate font-sans">
								{path}
								{file.isNew && (
									<span className="ml-2 text-[10px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded">
										new file
									</span>
								)}
								{file.isDeleted && (
									<span className="ml-2 text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">deleted</span>
								)}
							</span>
							{!file.isBinary && (
								<span className="shrink-0 text-[11px] font-sans">
									<span className="text-green-500">+{file.additions}</span>{" "}
									<span className="text-red-500">-{file.deletions}</span>
								</span>
							)}
							<button
								onClick={() => (openCommentKey === fileCommentKey ? onCloseComment() : onOpenComment(fileCommentKey))}
								className="shrink-0 text-gray-700 hover:text-blue-400 transition-colors p-0.5 rounded"
								title="Comment on file"
							>
								<MessageSquare size={12} />
							</button>
						</div>

						{/* File-level comment box */}
						{openCommentKey === fileCommentKey && (
							<InlineCommentBox
								draftRef={draftRef}
								value={commentDraft}
								onChange={onCommentDraftChange}
								onAdd={() => onCommitPending(path, fileCommentKey, null)}
								onCancel={onCloseComment}
							/>
						)}

						{/* File-level pending comments */}
						{filePendingComments
							.filter((c) => c.lineKey === fileCommentKey)
							.map((c) => (
								<PendingCommentBubble key={c.id} comment={c} onSave={onSaveComment} onRemove={onRemoveComment} />
							))}

						{/* Hunks */}
						{!isCollapsed &&
							!file.isBinary &&
							file.hunks.map((hunk, hi) => (
								<div key={hi}>
									{/* Hunk header */}
									<div className="px-2 py-0.5 bg-[#0d1a2d] text-[#4a7aad]/90 border-y border-[#1a2d3d]/60 whitespace-pre font-mono text-[11px]">
										{hunk.header}
									</div>

									{/* Lines */}
									{hunk.lines.map((line, li) => {
										const lineNum = line.newNum ?? line.oldNum;
										const lineKey = `${path}:${line.oldNum ?? "-"}:${line.newNum ?? "-"}`;
										const linePending = pendingComments.filter((c) => c.lineKey === lineKey);

										const rowBg =
											line.type === "added" ? "bg-[#0f3321]" : line.type === "removed" ? "bg-[#330f10]" : "";
										const numBg =
											line.type === "added"
												? "bg-[#143d27]"
												: line.type === "removed"
													? "bg-[#3d1416]"
													: "bg-transparent";
										const numColor =
											line.type === "added"
												? "text-green-700"
												: line.type === "removed"
													? "text-red-700"
													: "text-[#3a3a4a]";
										const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
										const signColor =
											line.type === "added"
												? "text-emerald-400"
												: line.type === "removed"
													? "text-red-400"
													: "text-transparent";
										const textColor =
											line.type === "added"
												? "text-[#b7f5d0]"
												: line.type === "removed"
													? "text-[#ffd0d2]"
													: "text-[#6b6b80]";

										return (
											<div key={li}>
												{/* Line row */}
												<div
													className={classNames("group relative flex hover:brightness-110 transition-[filter]", rowBg)}
												>
													{/* Line number */}
													<div
														className={classNames(
															"w-10 shrink-0 text-right pr-2 py-0.5 select-none border-r border-[#1e1e28] font-mono text-[11px]",
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
													<button
														onClick={() => (openCommentKey === lineKey ? onCloseComment() : onOpenComment(lineKey))}
														className="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:text-blue-300 p-0.5 rounded bg-[#1a1a28]"
													>
														<Plus size={11} />
													</button>
												</div>

												{/* Inline comment box */}
												{openCommentKey === lineKey && (
													<InlineCommentBox
														draftRef={draftRef}
														value={commentDraft}
														onChange={onCommentDraftChange}
														onAdd={() => onCommitPending(path, lineKey, lineNum)}
														onCancel={onCloseComment}
													/>
												)}

												{/* Pending comments on this line */}
												{linePending.map((c) => (
													<PendingCommentBubble
														key={c.id}
														comment={c}
														onSave={onSaveComment}
														onRemove={onRemoveComment}
													/>
												))}
											</div>
										);
									})}
								</div>
							))}

						{!isCollapsed && file.isBinary && (
							<div className="px-4 py-3 text-gray-500 italic font-sans text-xs">Binary file changed</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
