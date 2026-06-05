import type { TierLevel } from "@runtime-contract";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWrite } from "@/runtime/api-client";
import { ReopenPickerDialog } from "../ChatComments/ReopenPickerDialog";
import { CommitSelector } from "./CommitSelector";
import { DiffFileList } from "./DiffFileList";
import { FileTreeNode } from "./FileTreeNode";
import { buildFileTree } from "./parser";
import { type ReviewType, SubmitReviewDropdown } from "./SubmitReviewDropdown";
import type { PendingComment } from "./types";
import { useDiffData } from "./useDiffData";

interface Props {
	workspaceId: string;
	cardId: string;
	activeLevel: TierLevel;
	isReadyForReview: boolean;
	onRefresh: () => void;
}

export function DiffView({ workspaceId, cardId, activeLevel, isReadyForReview, onRefresh }: Props) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
	const [openCommentKey, setOpenCommentKey] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	// When a human picks "Request changes", we collect the tier for the rework
	// before reopening, so a stale agent-set level doesn't carry over to new scope.
	const [reopenFeedback, setReopenFeedback] = useState<string | null>(null);
	const [reopening, setReopening] = useState(false);
	const draftRef = useRef<HTMLTextAreaElement>(null);
	const diffScrollRef = useRef<HTMLDivElement>(null);

	const [sidebarWidth, setSidebarWidthRaw] = useState(() => {
		const stored = localStorage.getItem("diff-sidebar-width");
		return stored ? Math.max(120, Math.min(600, parseInt(stored, 10))) : 208;
	});
	const setSidebarWidth = (w: number) => {
		setSidebarWidthRaw(w);
		localStorage.setItem("diff-sidebar-width", String(w));
	};
	const sidebarResizing = useRef(false);
	const resizeStartX = useRef(0);
	const resizeStartWidth = useRef(0);

	const { trigger: addReviewCommentTrigger } = useWrite((api) => api("cards/add-review-comment").POST());
	const { trigger: submitHumanFeedbackTrigger } = useWrite((api) => api("cards/submit-human-feedback").POST());
	const { trigger: updateCardTrigger } = useWrite((api) => api("cards/:id").PATCH());

	const { selectedCommit, setSelectedCommit, files, loading, loadError, commits, baseBehindCount, refreshDiff } =
		useDiffData(workspaceId, cardId);

	// Sidebar resize drag handlers
	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!sidebarResizing.current) return;
			const newWidth = Math.max(120, Math.min(600, resizeStartWidth.current + e.clientX - resizeStartX.current));
			setSidebarWidth(newWidth);
		};
		const handleMouseUp = () => {
			if (!sidebarResizing.current) return;
			sidebarResizing.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);
		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};
	}, []);

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

	const openComment = (key: string) => {
		setOpenCommentKey(key);
		setCommentDraft("");
		setTimeout(() => draftRef.current?.focus(), 40);
	};

	const commitPending = (file: string, lineKey: string, lineNum: number | null) => {
		const text = commentDraft.trim();
		if (!text) return;
		setPendingComments((prev) => [...prev, { id: crypto.randomUUID(), file, lineKey, lineNum, text }]);
		setOpenCommentKey(null);
		setCommentDraft("");
	};

	const removePending = (id: string) => setPendingComments((prev) => prev.filter((c) => c.id !== id));

	const reviewSummary = (file: string, lineNum: number | null, text: string) =>
		lineNum !== null ? `**${file}** (line ${lineNum}):\n${text}` : `**${file}**:\n${text}`;

	const saveCommentNow = async (id: string) => {
		const c = pendingComments.find((c) => c.id === id);
		if (!c) return;
		const res = await addReviewCommentTrigger({
			body: {
				workspaceId,
				cardId,
				type: "human",
				actor: { type: "human", id: "human" },
				summary: reviewSummary(c.file, c.lineNum, c.text),
			},
		});
		if (res.error) return; // keep staged on error
		removePending(id);
		onRefresh();
	};

	const submitReview = async ({ reviewType, overallFeedback }: { reviewType: ReviewType; overallFeedback: string }) => {
		for (const c of pendingComments) {
			await addReviewCommentTrigger({
				body: {
					workspaceId,
					cardId,
					type: "human",
					actor: { type: "human", id: "human" },
					summary: reviewSummary(c.file, c.lineNum, c.text),
				},
			});
		}
		setPendingComments([]);
		// Defer the reopen until the human picks the tier for the rework.
		if (reviewType === "request_changes") {
			setReopenFeedback(overallFeedback);
			onRefresh();
			return;
		}
		if (overallFeedback) {
			await addReviewCommentTrigger({
				body: { workspaceId, cardId, type: "human", actor: { type: "human", id: "human" }, summary: overallFeedback },
			});
		}
		onRefresh();
	};

	const reopenWith = async (level: TierLevel) => {
		setReopening(true);
		try {
			if (level !== activeLevel) {
				await updateCardTrigger({
					params: { id: cardId },
					body: { workspaceId, cardId, revision: 0, activeLevel: level },
				});
			}
			await submitHumanFeedbackTrigger({ body: { workspaceId, cardId, comment: reopenFeedback || undefined } });
			setReopenFeedback(null);
			onRefresh();
		} finally {
			setReopening(false);
		}
	};

	// ── Loading / error states ────────────────────────────────────────────────
	if (loading) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading diff…</div>;
	}

	if (loadError) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
				<p className="text-sm">{loadError}</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
					<RefreshCw size={12} /> Retry
				</button>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
				<p className="text-sm">No changes yet</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
					<RefreshCw size={12} /> Refresh
				</button>
			</div>
		);
	}

	const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
	const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
	const fileTree = buildFileTree(files);

	return (
		<div className="flex-1 min-h-0 flex flex-col font-mono text-xs bg-[#0a0a0e] relative">
			{/* Top bar */}
			<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-[#0d0d12] font-sans">
				<span className="text-gray-500 text-xs">
					{files.length} file{files.length !== 1 ? "s" : ""}
					{" · "}
					<span className="text-green-500">+{totalAdditions}</span>{" "}
					<span className="text-red-500">-{totalDeletions}</span>
				</span>

				{commits.length > 0 && (
					<CommitSelector commits={commits} selectedCommit={selectedCommit} onSelectCommit={setSelectedCommit} />
				)}

				<div className="flex-1" />

				<button
					onClick={refreshDiff}
					className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
					title="Refresh diff"
				>
					<RefreshCw size={13} />
				</button>

				{isReadyForReview && <SubmitReviewDropdown pendingComments={pendingComments} onSubmit={submitReview} />}
			</div>

			{/* Base branch drift notice */}
			{baseBehindCount > 0 && !selectedCommit && (
				<div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-amber-950/40 border-b border-amber-800/40 font-sans">
					<AlertTriangle size={12} className="text-amber-400 shrink-0" />
					<span className="text-amber-300/90 text-xs">
						Base branch has {baseBehindCount} new commit{baseBehindCount !== 1 ? "s" : ""} not yet in this branch — they
						will be included when merged and are not shown here.
					</span>
				</div>
			)}

			{/* Main layout: sidebar + diff content */}
			<div className="flex flex-1 min-h-0">
				{/* File tree sidebar */}
				<div
					className="relative shrink-0 border-r border-[#1e1e28] overflow-y-auto bg-[#0d0d12] py-2"
					style={{ width: sidebarWidth }}
				>
					<FileTreeNode
						node={fileTree}
						depth={0}
						collapsedDirs={collapsedDirs}
						onToggleDir={toggleDir}
						onFileClick={scrollToFile}
					/>
					{/* Resize handle */}
					<div
						onMouseDown={(e) => {
							sidebarResizing.current = true;
							resizeStartX.current = e.clientX;
							resizeStartWidth.current = sidebarWidth;
							document.body.style.cursor = "col-resize";
							document.body.style.userSelect = "none";
							e.preventDefault();
						}}
						className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/40 transition-colors z-10 group"
						title="Drag to resize"
					>
						<div className="absolute inset-y-0 right-0 w-px bg-[#1e1e28] group-hover:bg-blue-500/60 transition-colors" />
					</div>
				</div>

				{/* Diff content */}
				<DiffFileList
					files={files}
					scrollRef={diffScrollRef}
					draftRef={draftRef}
					collapsed={collapsed}
					onToggleCollapse={toggleCollapse}
					openCommentKey={openCommentKey}
					onOpenComment={openComment}
					onCloseComment={() => setOpenCommentKey(null)}
					commentDraft={commentDraft}
					onCommentDraftChange={setCommentDraft}
					onCommitPending={commitPending}
					pendingComments={pendingComments}
					onSaveComment={saveCommentNow}
					onRemoveComment={removePending}
				/>
			</div>

			{reopenFeedback !== null && (
				<ReopenPickerDialog
					currentLevel={activeLevel}
					submitting={reopening}
					onConfirm={(level) => void reopenWith(level)}
					onClose={() => setReopenFeedback(null)}
				/>
			)}
		</div>
	);
}
