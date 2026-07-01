import type React from "react";
import { displayPath, fileElemId } from "../board/components/DiffView/parser";
import type { DiffFile } from "../board/components/DiffView/types";
import { classNames } from "@/utils/classNames";

// A read-only sibling of DiffFileList (board/components/DiffView) — same visual
// rendering of files/hunks/lines, minus the inline-commenting affordances, which
// only make sense for ticket review and have nowhere to go for a companion session.
export function CompanionDiffFileList({
	files,
	scrollRef,
	collapsed,
	onToggleCollapse,
}: {
	files: DiffFile[];
	scrollRef: React.RefObject<HTMLDivElement>;
	collapsed: Set<string>;
	onToggleCollapse: (path: string) => void;
}) {
	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto">
			{files.map((file) => {
				const path = displayPath(file);
				const isCollapsed = collapsed.has(path);

				return (
					<div key={path} id={fileElemId(path)} className="border-b border-[#1e1e28]">
						<div className="flex items-center gap-2 px-3 py-2 bg-[#111118] border-b border-[#1e1e28] sticky top-0 z-10">
							<button
								onClick={() => onToggleCollapse(path)}
								className="text-gray-600 hover:text-gray-400 shrink-0 transition-colors"
							>
								{isCollapsed ? "▸" : "▾"}
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
						</div>

						{!isCollapsed &&
							!file.isBinary &&
							file.hunks.map((hunk, hi) => (
								<div key={hi}>
									<div className="px-2 py-0.5 bg-[#0d1a2d] text-[#4a7aad]/90 border-y border-[#1a2d3d]/60 whitespace-pre font-mono text-[11px]">
										{hunk.header}
									</div>
									{hunk.lines.map((line, li) => {
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
											<div key={li} className={classNames("flex hover:brightness-110 transition-[filter]", rowBg)}>
												<div
													className={classNames(
														"w-10 shrink-0 text-right pr-2 py-0.5 select-none border-r border-[#1e1e28] font-mono text-[11px]",
														numBg,
														numColor,
													)}
												>
													{line.newNum ?? line.oldNum ?? ""}
												</div>
												<div className="w-5 shrink-0 text-center py-0.5 select-none">
													<span className={classNames("font-mono", signColor)}>{sign}</span>
												</div>
												<div
													className={classNames("flex-1 py-0.5 pr-7 whitespace-pre font-mono text-[12px]", textColor)}
												>
													{line.content}
												</div>
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
