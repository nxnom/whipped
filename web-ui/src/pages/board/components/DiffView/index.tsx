import type { TierLevel } from "@runtime-contract";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ReopenPickerDialog } from "../ChatComments/ReopenPickerDialog";
import { CommitSelector } from "./CommitSelector";
import { DiffFileList } from "./DiffFileList";
import { FileTreeNode } from "./FileTreeNode";
import { buildFileTree } from "./parser";
import { type ReviewType, SubmitReviewDropdown } from "./SubmitReviewDropdown";
import type { PendingComment } from "./types";
import type { useDiffData } from "./useDiffData";

// Review/reopen only make sense where there's a ticket workflow behind the
// diff — omit this entirely (e.g. the companion page's session diff) and
// DiffView renders read-only with no comment affordances or submit control.
export interface DiffCommentSystem {
	isReadyForReview: boolean;
	activeLevel: TierLevel;
	onRefresh: () => void;
	addComment: (summary: string) => Promise<boolean>;
	submitFeedback: (comment?: string) => Promise<void>;
	setActiveLevel: (level: TierLevel) => Promise<void>;
}

interface Props {
	diffData: ReturnType<typeof useDiffData>;
	commentSystem?: DiffCommentSystem;
}

export function DiffView({ diffData, commentSystem }: Props) {
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

	const { selectedCommit, setSelectedCommit, files, loading, loadError, commits, baseBehindCount, refreshDiff } =
		diffData;

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
		if (!commentSystem) return;
		const c = pendingComments.find((c) => c.id === id);
		if (!c) return;
		const ok = await commentSystem.addComment(reviewSummary(c.file, c.lineNum, c.text));
		if (!ok) return; // keep staged on error
		removePending(id);
		commentSystem.onRefresh();
	};

	const submitReview = async ({ reviewType, overallFeedback }: { reviewType: ReviewType; overallFeedback: string }) => {
		if (!commentSystem) return;
		for (const c of pendingComments) {
			await commentSystem.addComment(reviewSummary(c.file, c.lineNum, c.text));
		}
		setPendingComments([]);
		// Defer the reopen until the human picks the tier for the rework.
		if (reviewType === "request_changes") {
			setReopenFeedback(overallFeedback);
			commentSystem.onRefresh();
			return;
		}
		if (overallFeedback) {
			await commentSystem.addComment(overallFeedback);
		}
		commentSystem.onRefresh();
	};

	const reopenWith = async (level: TierLevel) => {
		if (!commentSystem) return;
		setReopening(true);
		try {
			if (level !== commentSystem.activeLevel) {
				await commentSystem.setActiveLevel(level);
			}
			await commentSystem.submitFeedback(reopenFeedback || undefined);
			setReopenFeedback(null);
			commentSystem.onRefresh();
		} finally {
			setReopening(false);
		}
	};

	// ── Loading / error states ────────────────────────────────────────────────
	if (loading) {
		return <div className="flex-1 flex items-center justify-center text-whip-muted text-sm">Loading diff…</div>;
	}

	if (loadError) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-whip-muted">
				<p className="text-sm">{loadError}</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-whip-text hover:text-white">
					<RefreshCw size={12} /> Retry
				</button>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-whip-muted">
				<p className="text-sm">No changes yet</p>
				<button onClick={refreshDiff} className="flex items-center gap-1.5 text-xs text-whip-text hover:text-white">
					<RefreshCw size={12} /> Refresh
				</button>
			</div>
		);
	}

	const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
	const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
	const fileTree = buildFileTree(files);

	return (
		<div className="flex-1 min-h-0 flex flex-col font-mono text-xs bg-whip-bg relative">
			{/* Top bar */}
			<div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-whip-border-soft bg-whip-bg font-sans">
				<span className="text-whip-muted text-xs">
					{files.length} file{files.length !== 1 ? "s" : ""}
					{" · "}
					<span className="text-[#22c55e]">+{totalAdditions}</span>{" "}
					<span className="text-[#ff3b4d]">-{totalDeletions}</span>
				</span>

				{commits.length > 0 && (
					<CommitSelector commits={commits} selectedCommit={selectedCommit} onSelectCommit={setSelectedCommit} />
				)}

				<div className="flex-1" />

				<button
					onClick={refreshDiff}
					className="text-whip-faint hover:text-whip-text transition-colors p-1 rounded hover:bg-whip-panel-2"
					title="Refresh diff"
				>
					<RefreshCw size={13} />
				</button>

				{commentSystem?.isReadyForReview && (
					<SubmitReviewDropdown pendingComments={pendingComments} onSubmit={submitReview} />
				)}
			</div>

			{/* Base branch drift notice */}
			{baseBehindCount > 0 && !selectedCommit && (
				<div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#eab308]/10 border-b border-[#eab308]/30 font-sans">
					<AlertTriangle size={12} className="text-[#eab308] shrink-0" />
					<span className="text-[#eab308]/90 text-xs">
						Base branch has {baseBehindCount} new commit{baseBehindCount !== 1 ? "s" : ""} not yet in this branch — they
						will be included when merged and are not shown here.
					</span>
				</div>
			)}

			{/* Main layout: sidebar + diff content */}
			<div className="flex flex-1 min-h-0">
				{/* File tree sidebar */}
				<div
					className="relative shrink-0 border-r border-whip-border-soft overflow-y-auto bg-whip-bg py-2"
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
						className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-white/20 transition-colors z-10 group"
						title="Drag to resize"
					>
						<div className="absolute inset-y-0 right-0 w-px bg-whip-border-soft group-hover:bg-white/60 transition-colors" />
					</div>
				</div>

				{/* Diff content */}
				<DiffFileList
					files={files}
					scrollRef={diffScrollRef}
					collapsed={collapsed}
					onToggleCollapse={toggleCollapse}
					comments={
						commentSystem
							? {
									draftRef,
									openCommentKey,
									onOpenComment: openComment,
									onCloseComment: () => setOpenCommentKey(null),
									commentDraft,
									onCommentDraftChange: setCommentDraft,
									onCommitPending: commitPending,
									pendingComments,
									onSaveComment: saveCommentNow,
									onRemoveComment: removePending,
								}
							: undefined
					}
				/>
			</div>

			{commentSystem && reopenFeedback !== null && (
				<ReopenPickerDialog
					currentLevel={commentSystem.activeLevel}
					submitting={reopening}
					onConfirm={(level) => void reopenWith(level)}
					onClose={() => setReopenFeedback(null)}
				/>
			)}
		</div>
	);
}
