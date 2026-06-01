import { ConfirmDialog, toast } from "@geckoui/geckoui";
import type { WorkflowSlot } from "@runtime-contract";
import { Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { AgentBadge } from "./AgentBadge";
import { AttachmentItem } from "./AttachmentItem";
import { Avatar } from "./Avatar";
import { SEVERITY_COLOR } from "./constants";
import { displayName, formatDateLabel } from "./helpers";
import { makeMdComponents } from "./markdown";
import type { CommentEntry } from "./types";

interface VisualElement {
	elementSelector?: string;
	elementText?: string;
	componentName?: string;
	componentChain?: string[];
	sourceFile?: string;
	sourceLine?: number;
}

// Must match the palette in extension/content.js so an element's color identity
// (page outline, badge, #N mention) carries over to the board.
const ELEMENT_PALETTE = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#22d3ee", "#a3e635"];
const colorFor = (i: number) => ELEMENT_PALETTE[i % ELEMENT_PALETTE.length];

interface CommentItemProps {
	entry: CommentEntry;
	workspaceId: string;
	showDate: boolean;
	showHeader: boolean;
	workflowSlots?: WorkflowSlot[];
}

export function CommentItem({ entry, workspaceId, showDate, showHeader, workflowSlots }: CommentItemProps) {
	const { comment, sourceCardId, sourceCardTitle } = entry;
	const name = displayName(comment, workflowSlots);
	const { trigger: deleteComment } = useWrite((api) => api("cards/:cardId/review-comments/:commentId").DELETE());
	const isImg = (att: { mimeType?: string; name: string }) =>
		(att.mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
	const images = (comment.attachments ?? []).filter(isImg);
	const files = (comment.attachments ?? []).filter((a) => !isImg(a));
	const vc =
		comment.type === "visual-comment" && comment.metadata?.visualComment
			? (comment.metadata.visualComment as { pageUrl?: string; elements?: VisualElement[] })
			: null;
	const vcElements: VisualElement[] = vc?.elements ?? [];

	const handleDelete = () => {
		ConfirmDialog.show({
			title: "Delete comment?",
			content: "This comment will be permanently deleted.",
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					await deleteComment({ params: { cardId: sourceCardId, commentId: comment.id }, body: { workspaceId } });
					dismiss();
				} catch {
					toast.error("Failed to delete comment");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return (
		<div>
			{showDate && (
				<div className="flex items-center gap-3 px-4 my-3">
					<div className="flex-1 h-px bg-[#1e1e28]" />
					<span className="text-[11px] text-[#4a4a5a] font-medium shrink-0">{formatDateLabel(comment.createdAt)}</span>
					<div className="flex-1 h-px bg-[#1e1e28]" />
				</div>
			)}

			<div
				className={classNames(
					"group flex items-start gap-3 px-4 hover:bg-[#13131a]",
					showHeader ? "mt-3 pb-0.5" : "py-0.5",
				)}
			>
				{/* Avatar column — always reserve space */}
				<div className="w-8 shrink-0 mt-0.5">
					{showHeader ? (
						<Avatar comment={comment} />
					) : (
						<span className="block w-8 text-center text-[8px] text-[#3a3a4a] opacity-0 group-hover:opacity-100 transition-opacity tabular-nums whitespace-nowrap pt-1">
							{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
						</span>
					)}
				</div>

				<div className="flex-1 min-w-0">
					{showHeader && (
						<div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
							<span className="font-semibold text-sm text-gray-100">{name}</span>
							<AgentBadge comment={comment} />
							<span className="text-xs text-[#4a4a5a] tabular-nums">
								{new Date(comment.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
							</span>
							{sourceCardTitle && (
								<span
									className="text-[10px] px-1.5 py-0.5 rounded font-medium text-[#6a6a80] bg-[#1a1a24] border border-[#2a2a38] truncate max-w-[160px]"
									title={sourceCardTitle}
								>
									{sourceCardTitle}
								</span>
							)}
						</div>
					)}
					<div className="prose-chat text-sm text-gray-300 leading-relaxed [overflow-wrap:anywhere]">
						<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={makeMdComponents()}>
							{comment.summary.trimEnd()}
						</ReactMarkdown>
					</div>

					{/* Issues */}
					{comment.issues && comment.issues.length > 0 && (
						<details className="mt-1">
							<summary className="text-[11px] text-gray-500 cursor-pointer">
								{comment.issues.length} issue{comment.issues.length !== 1 ? "s" : ""}
							</summary>
							<ul className="mt-1 space-y-0.5">
								{comment.issues.map((issue, idx) => (
									<li key={idx} className="text-[11px] font-mono text-gray-400">
										<span className={SEVERITY_COLOR[issue.severity] ?? "text-gray-400"}>[{issue.severity}]</span>{" "}
										{issue.file}
										{issue.line != null ? `:${issue.line}` : ""}
										{issue.file ? " — " : ""}
										{issue.message}
									</li>
								))}
							</ul>
						</details>
					)}

					{/* Visual comment metadata */}
					{vc && (
						<div className="mt-1.5 flex flex-col gap-1.5 px-2 py-1.5 rounded bg-[#7c6aff]/8 border border-[#7c6aff]/20 text-[11px] text-[#8888a0]">
							<div className="flex items-center gap-1.5">
								<span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-[#a78bfa] bg-[#7c6aff]/15">
									Visual
								</span>
								{vcElements.length > 1 && <span className="text-[#6a6a80]">{vcElements.length} elements</span>}
							</div>
							{vcElements.map((el, idx) => {
								const shortFile = el.sourceFile?.split("/").slice(-2).join("/");
								const chainDisplay = el.componentChain?.length ? el.componentChain.join(" → ") : el.componentName;
								const multi = vcElements.length > 1;
								return (
									<div
										key={idx}
										className={classNames("flex flex-col gap-1", multi && "pl-2 border-l-2")}
										style={multi ? { borderColor: colorFor(idx) } : undefined}
									>
										<div className="flex items-center gap-1.5 flex-wrap">
											{multi && (
												<span
													className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-[#0c0c0f]"
													style={{ backgroundColor: colorFor(idx) }}
												>
													{idx + 1}
												</span>
											)}
											{el.elementSelector && <code className="font-mono text-[#c4baff]">{el.elementSelector}</code>}
											{chainDisplay && <span className="text-[#6a6a80]">⚛ {chainDisplay}</span>}
										</div>
										{el.elementText && <div className="text-[#a0a0b8] italic line-clamp-2">"{el.elementText}"</div>}
										{shortFile && (
											<span className="font-mono text-[#4a4a5a]">
												{shortFile}
												{el.sourceLine != null ? `:${el.sourceLine}` : ""}
											</span>
										)}
									</div>
								);
							})}
							{vc.pageUrl && (
								<a
									href={vc.pageUrl}
									target="_blank"
									rel="noreferrer"
									className="truncate text-[#4a4a5a] hover:text-[#8888a0] transition-colors"
								>
									{vc.pageUrl}
								</a>
							)}
						</div>
					)}

					{/* Attachments */}
					{comment.attachments && comment.attachments.length > 0 && (
						<div className="mt-1 space-y-1.5">
							{images.length > 0 && (
								<div className="flex flex-wrap gap-2">
									{images.map((att, idx) => (
										<AttachmentItem key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
									))}
								</div>
							)}
							{files.length > 0 && (
								<div className="flex flex-wrap gap-1.5">
									{files.map((att, idx) => (
										<AttachmentItem key={idx} path={att.path} name={att.name} mimeType={att.mimeType} />
									))}
								</div>
							)}
						</div>
					)}
				</div>

				<button
					type="button"
					onClick={handleDelete}
					title="Delete comment"
					aria-label="Delete comment"
					className="shrink-0 mt-2 p-1 rounded text-[#4a4a5a] opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400 hover:bg-[#1e1e28]"
				>
					<Trash2 className="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	);
}
