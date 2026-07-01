import { ChevronLeft, ChevronRight, MessageSquare, MessageSquarePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/utils/classNames";
import { PlanBlockRenderer } from "./PlanBlockRenderer";
import { PlanFeedbackComposer } from "./PlanFeedbackComposer";
import { PlanVersionSelector } from "./PlanVersionSelector";
import type { PlanAnswers, PlanComment } from "./types";
import { useCompanionPlans } from "./useCompanionPlans";

const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 420;
const WIDTH_STORAGE_KEY = "companion-plan-width";

export function PlanPanel({ sessionId, workspaceId }: { sessionId: string; workspaceId: string }) {
	const { plans, sendFeedback } = useCompanionPlans(workspaceId, sessionId);

	const [collapsed, setCollapsed] = useState(false);
	const [width, setWidth] = useState(() => {
		const stored = localStorage.getItem(WIDTH_STORAGE_KEY);
		return stored ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(stored, 10))) : DEFAULT_WIDTH;
	});
	const setPersistedWidth = (w: number) => {
		setWidth(w);
		localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
	};
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
	const [answers, setAnswers] = useState<PlanAnswers>({});
	const [comments, setComments] = useState<PlanComment[]>([]);
	const [commentDraftFor, setCommentDraftFor] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");

	const latestVersion = plans[0]?.version ?? null;

	// Follow the latest version as new ones arrive; reset staged feedback since
	// it was composed against the previous version's blocks/ids.
	useEffect(() => {
		if (latestVersion === null) return;
		setSelectedVersion(latestVersion);
		setAnswers({});
		setComments([]);
	}, [latestVersion]);

	if (plans.length === 0) return null;

	const activePlan = plans.find((p) => p.version === selectedVersion) ?? plans[0]!;
	const isLatest = activePlan.version === latestVersion;

	const onDragStart = (e: React.MouseEvent) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		const onMove = (ev: MouseEvent) => {
			if (!dragRef.current) return;
			const delta = dragRef.current.startX - ev.clientX;
			setPersistedWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
		};
		const onUp = () => {
			dragRef.current = null;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	const addComment = (blockId: string) => {
		if (!commentDraft.trim()) return;
		setComments((prev) => [...prev, { id: crypto.randomUUID(), blockId, text: commentDraft.trim() }]);
		setCommentDraftFor(null);
		setCommentDraft("");
	};

	if (collapsed) {
		return (
			<div className="shrink-0 flex flex-col items-center border-l border-[#2a2a35] bg-[#141418] w-8 py-3">
				<button onClick={() => setCollapsed(false)} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
					<ChevronLeft size={14} />
				</button>
			</div>
		);
	}

	return (
		<div className="shrink-0 flex overflow-hidden" style={{ width }}>
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-[#7c6aff]/40 active:bg-[#7c6aff]/60 transition-colors bg-[#2a2a35]"
			/>
			<div className="flex-1 border-l border-[#2a2a35] flex flex-col overflow-hidden bg-[#141418]">
				<div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2a35] shrink-0">
					<span className="text-[13px] font-semibold text-[#f0f0f5]">Plan</span>
					<div className="flex items-center gap-2">
						<PlanVersionSelector
							plans={plans}
							selectedVersion={activePlan.version}
							onSelectVersion={setSelectedVersion}
						/>
						<button
							onClick={() => setCollapsed(true)}
							className="text-[#60607a] hover:text-[#f0f0f5] transition-colors"
						>
							<ChevronRight size={14} />
						</button>
					</div>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
					{activePlan.blocks.map((block) => (
						<div key={block.id} className="group relative flex flex-col gap-1.5">
							<PlanBlockRenderer
								block={block}
								answers={answers}
								onAnswer={(name, value) => setAnswers((prev) => ({ ...prev, [name]: value }))}
							/>
							{comments
								.filter((c) => c.blockId === block.id)
								.map((c) => (
									<div
										key={c.id}
										className="flex items-start gap-1.5 ml-1 pl-2.5 py-0.5 border-l border-dashed border-[#3a3a48]"
									>
										<MessageSquare size={11} className="mt-0.5 shrink-0 text-gray-600" />
										<span className="flex-1 text-[11px] text-gray-400 italic">{c.text}</span>
										{isLatest && (
											<button
												onClick={() => setComments((prev) => prev.filter((existing) => existing.id !== c.id))}
												className="shrink-0 text-gray-600 hover:text-red-400 transition-colors"
											>
												<X size={11} />
											</button>
										)}
									</div>
								))}
							{isLatest &&
								(commentDraftFor === block.id ? (
									<div className="flex flex-col gap-1.5">
										<textarea
											autoFocus
											value={commentDraft}
											onChange={(e) => setCommentDraft(e.target.value)}
											placeholder="Leave a comment on this section…"
											className="w-full resize-none rounded-md bg-[#0d0d12] border border-[#2a2a35] px-2.5 py-1.5 text-[12px] text-[#f0f0f5] placeholder:text-[#3a3a45] outline-none focus:border-[#3a3a48]"
											rows={2}
										/>
										<div className="flex items-center gap-2 self-end">
											<button
												onClick={() => {
													setCommentDraftFor(null);
													setCommentDraft("");
												}}
												className="text-[11px] text-gray-500 hover:text-gray-300"
											>
												Cancel
											</button>
											<button
												onClick={() => addComment(block.id)}
												className="text-[11px] text-[#7c6aff] hover:text-[#9b8cff]"
											>
												Add
											</button>
										</div>
									</div>
								) : (
									<button
										onClick={() => setCommentDraftFor(block.id)}
										className={classNames(
											"self-start flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-300 transition-opacity",
											"opacity-0 group-hover:opacity-100",
										)}
									>
										<MessageSquarePlus size={12} /> Comment
									</button>
								))}
						</div>
					))}
				</div>

				{isLatest && (
					<PlanFeedbackComposer
						sessionId={sessionId}
						version={activePlan.version}
						blocks={activePlan.blocks}
						answers={answers}
						comments={comments}
						sendFeedback={sendFeedback}
						onSent={() => {
							setAnswers({});
							setComments([]);
						}}
					/>
				)}
			</div>
		</div>
	);
}
