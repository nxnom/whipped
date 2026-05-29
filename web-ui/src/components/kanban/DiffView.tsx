import { Button } from "@geckoui/geckoui";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	File,
	Folder,
	FolderOpen,
	GitCommit,
	MessageSquare,
	Plus,
	RefreshCw,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiffLine {
	type: "added" | "removed" | "context";
	content: string;
	oldNum: number | null;
	newNum: number | null;
}

interface DiffHunk {
	header: string;
	lines: DiffLine[];
}

interface DiffFile {
	oldPath: string;
	newPath: string;
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
	isBinary: boolean;
	isNew: boolean;
	isDeleted: boolean;
}

interface PendingComment {
	id: string;
	file: string;
	lineKey: string;
	lineNum: number | null;
	text: string;
}

interface TreeNode {
	name: string;
	fullPath: string;
	isFile: boolean;
	file?: DiffFile;
	children: TreeNode[];
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | null = null;
	let hunk: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	for (const line of raw.split("\n")) {
		if (line.startsWith("diff --git ")) {
			if (file) files.push(file);
			file = {
				oldPath: "",
				newPath: "",
				additions: 0,
				deletions: 0,
				hunks: [],
				isBinary: false,
				isNew: false,
				isDeleted: false,
			};
			hunk = null;
		} else if (file && (line.startsWith("new file mode") || line === "new file")) {
			file.isNew = true;
		} else if (file && (line.startsWith("deleted file mode") || line === "deleted file")) {
			file.isDeleted = true;
		} else if (file && line.startsWith("Binary files")) {
			file.isBinary = true;
		} else if (file && line.startsWith("--- ")) {
			const p = line.slice(4);
			file.oldPath = p === "/dev/null" ? "/dev/null" : p.startsWith("a/") ? p.slice(2) : p;
		} else if (file && line.startsWith("+++ ")) {
			const p = line.slice(4);
			file.newPath = p === "/dev/null" ? "/dev/null" : p.startsWith("b/") ? p.slice(2) : p;
		} else if (file && line.startsWith("@@ ")) {
			const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (m) {
				oldLine = parseInt(m[1]!, 10) - 1;
				newLine = parseInt(m[2]!, 10) - 1;
			}
			hunk = { header: line, lines: [] };
			file.hunks.push(hunk);
		} else if (hunk && file) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				newLine++;
				hunk.lines.push({ type: "added", content: line.slice(1), oldNum: null, newNum: newLine });
				file.additions++;
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				oldLine++;
				hunk.lines.push({ type: "removed", content: line.slice(1), oldNum: oldLine, newNum: null });
				file.deletions++;
			} else if (line.startsWith(" ")) {
				oldLine++;
				newLine++;
				hunk.lines.push({ type: "context", content: line.slice(1), oldNum: oldLine, newNum: newLine });
			}
		}
	}

	if (file) files.push(file);
	return files.filter((f) => f.oldPath || f.newPath || f.isBinary);
}

function displayPath(file: DiffFile): string {
	if (file.isNew) return file.newPath;
	if (file.isDeleted) return file.oldPath;
	if (file.oldPath !== file.newPath && file.oldPath && file.newPath) return `${file.oldPath} → ${file.newPath}`;
	return file.newPath || file.oldPath;
}

function fileElemId(path: string): string {
	return `diff-file-${path.replace(/[^a-z0-9]/gi, "_")}`;
}

function buildFileTree(files: DiffFile[]): TreeNode {
	const root: TreeNode = { name: "", fullPath: "", isFile: false, children: [] };

	function insertFile(dirParts: string[], name: string, fullPath: string, file: DiffFile) {
		let node = root;
		for (let i = 0; i < dirParts.length; i++) {
			const part = dirParts[i]!;
			const fp = dirParts.slice(0, i + 1).join("/");
			let child = node.children.find((c) => c.fullPath === fp);
			if (!child) {
				child = { name: part, fullPath: fp, isFile: false, children: [] };
				node.children.push(child);
			}
			node = child;
		}
		node.children.push({ name, fullPath, isFile: true, file, children: [] });
	}

	for (const file of files) {
		const path = displayPath(file);
		if (path.includes(" → ")) {
			// Rename: place under new path's directory, show "oldFile → newFile"
			const [oldPath, newPath] = path.split(" → ") as [string, string];
			const newParts = newPath.split("/");
			const newFilename = newParts.pop()!;
			const oldFilename = oldPath.split("/").pop()!;
			const shortName = oldFilename === newFilename ? newFilename : `${oldFilename} → ${newFilename}`;
			insertFile(newParts, shortName, path, file);
		} else {
			const parts = path.split("/");
			const filename = parts.pop()!;
			insertFile(parts, filename, path, file);
		}
	}

	sortTree(root);
	return root;
}

function sortTree(node: TreeNode): void {
	node.children.sort((a, b) => {
		if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
		return a.name.localeCompare(b.name);
	});
	for (const child of node.children) {
		if (!child.isFile) sortTree(child);
	}
}

// ── File Tree Sidebar ─────────────────────────────────────────────────────────

function FileTreeNode({
	node,
	depth,
	collapsedDirs,
	onToggleDir,
	onFileClick,
}: {
	node: TreeNode;
	depth: number;
	collapsedDirs: Set<string>;
	onToggleDir: (path: string) => void;
	onFileClick: (path: string) => void;
}) {
	if (node.isFile) {
		const additions = node.file?.additions ?? 0;
		const deletions = node.file?.deletions ?? 0;
		const isNew = node.file?.isNew ?? false;
		const isDeleted = node.file?.isDeleted ?? false;
		return (
			<button
				onClick={() => onFileClick(node.fullPath)}
				title={node.fullPath}
				className="flex items-center gap-2 w-full text-left py-1 hover:bg-[#1a1a24] rounded text-[14px] text-gray-400 hover:text-gray-200 font-sans transition-colors"
				style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8 }}
			>
				<File
					size={13}
					className={classNames("shrink-0", isNew ? "text-green-600" : isDeleted ? "text-red-600" : "text-gray-600")}
				/>
				<span className="flex-1 truncate min-w-0">{node.name}</span>
				{isNew && (
					<span className="shrink-0 text-[10px] font-medium text-green-400 bg-green-400/10 px-1 rounded">new</span>
				)}
				{isDeleted && (
					<span className="shrink-0 text-[10px] font-medium text-red-400 bg-red-400/10 px-1 rounded">del</span>
				)}
				{!isNew && !isDeleted && (
					<span className="shrink-0 font-mono text-[11px]">
						{additions > 0 && <span className="text-green-600">+{additions}</span>}
						{deletions > 0 && (
							<span className="text-red-700">
								{additions > 0 ? " " : ""}-{deletions}
							</span>
						)}
					</span>
				)}
				{isNew && additions > 0 && <span className="shrink-0 font-mono text-[11px] text-green-600">+{additions}</span>}
				{isDeleted && deletions > 0 && (
					<span className="shrink-0 font-mono text-[11px] text-red-600">-{deletions}</span>
				)}
			</button>
		);
	}

	const isCollapsed = collapsedDirs.has(node.fullPath);
	return (
		<div>
			{node.name && (
				<button
					onClick={() => onToggleDir(node.fullPath)}
					className="flex items-center gap-1.5 w-full text-left py-1 hover:bg-[#1a1a24] rounded text-[14px] text-gray-500 hover:text-gray-400 font-sans transition-colors"
					style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8 }}
				>
					{isCollapsed ? (
						<ChevronRight size={13} className="shrink-0 text-gray-600" />
					) : (
						<ChevronDown size={13} className="shrink-0 text-gray-600" />
					)}
					{isCollapsed ? (
						<Folder size={13} className="shrink-0 text-yellow-600/60 ml-0.5" />
					) : (
						<FolderOpen size={13} className="shrink-0 text-yellow-500/60 ml-0.5" />
					)}
					<span className="ml-0.5">{node.name}</span>
				</button>
			)}
			{!isCollapsed &&
				node.children.map((child) => (
					<FileTreeNode
						key={child.fullPath}
						node={child}
						depth={node.name ? depth + 1 : depth}
						collapsedDirs={collapsedDirs}
						onToggleDir={onToggleDir}
						onFileClick={onFileClick}
					/>
				))}
		</div>
	);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
	workspaceId: string;
	cardId: string;
	isReadyForReview: boolean;
	onRefresh: () => void;
}

export function DiffView({ workspaceId, cardId, isReadyForReview, onRefresh }: Props) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
	const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
	const [openCommentKey, setOpenCommentKey] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
	const [showCommitDropdown, setShowCommitDropdown] = useState(false);
	const [showReviewPanel, setShowReviewPanel] = useState(false);
	const [reviewType, setReviewType] = useState<"comment" | "request_changes">("comment");
	const [overallFeedback, setOverallFeedback] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const draftRef = useRef<HTMLTextAreaElement>(null);
	const diffScrollRef = useRef<HTMLDivElement>(null);
	const commitDropdownRef = useRef<HTMLDivElement>(null);
	const reviewDropdownRef = useRef<HTMLDivElement>(null);
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

	// Declarative reads — the active one is chosen by selectedCommit and refetches
	// automatically when it changes. Values are derived below, never mirrored into
	// state (Spoosh data refs change each render → a setState-in-effect would loop).
	const { data: commitsData } = useRead((api) => api("cards/commits").GET({ query: { workspaceId, cardId } }));
	const latestDiffRead = useRead((api) => api("cards/diff").GET({ query: { workspaceId, cardId } }), {
		enabled: !selectedCommit,
	});
	const commitDiffRead = useRead(
		(api) => api("cards/diff-for-commit").GET({ query: { workspaceId, cardId, commitHash: selectedCommit ?? "" } }),
		{ enabled: !!selectedCommit },
	);

	const activeDiffRead = selectedCommit ? commitDiffRead : latestDiffRead;
	const diffResult = activeDiffRead.data;
	const loading = activeDiffRead.loading;
	const loadError = activeDiffRead.error
		? activeDiffRead.error.message
		: diffResult
			? (diffResult.error ?? (diffResult.diff === null ? "No diff available" : null))
			: null;
	const diffText = diffResult && !diffResult.error ? diffResult.diff : null;
	const files = useMemo(() => (diffText ? parseDiff(diffText) : []), [diffText]);
	const baseBehindCount = !selectedCommit ? (latestDiffRead.data?.baseBehindCount ?? 0) : 0;
	const commits = commitsData?.commits ?? [];

	const refreshDiff = () => {
		void activeDiffRead.trigger();
	};

	// Close commit dropdown on outside click
	useEffect(() => {
		if (!showCommitDropdown) return;
		const handler = (e: MouseEvent) => {
			if (commitDropdownRef.current && !commitDropdownRef.current.contains(e.target as Node)) {
				setShowCommitDropdown(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [showCommitDropdown]);

	// Close review dropdown on outside click
	useEffect(() => {
		if (!showReviewPanel) return;
		const handler = (e: MouseEvent) => {
			if (reviewDropdownRef.current && !reviewDropdownRef.current.contains(e.target as Node)) {
				setShowReviewPanel(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [showReviewPanel]);

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

	const handleSelectCommit = (hash: string | null) => {
		setSelectedCommit(hash);
		setShowCommitDropdown(false);
	};

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
		const id = fileElemId(path);
		const el = document.getElementById(id);
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

	const saveCommentNow = async (id: string) => {
		const c = pendingComments.find((c) => c.id === id);
		if (!c) return;
		const summary = c.lineNum !== null ? `**${c.file}** (line ${c.lineNum}):\n${c.text}` : `**${c.file}**:\n${c.text}`;
		const res = await addReviewCommentTrigger({
			body: {
				workspaceId,
				cardId,
				type: "human",
				actor: { type: "human", id: "human" },
				summary,
			},
		});
		if (res.error) return; // keep staged on error
		removePending(id);
		onRefresh();
	};

	const handleSubmitReview = async () => {
		if (!overallFeedback.trim() && pendingComments.length === 0) return;
		setSubmitting(true);
		try {
			for (const c of pendingComments) {
				const summary =
					c.lineNum !== null ? `**${c.file}** (line ${c.lineNum}):\n${c.text}` : `**${c.file}**:\n${c.text}`;
				await addReviewCommentTrigger({
					body: {
						workspaceId,
						cardId,
						type: "human",
						actor: { type: "human", id: "human" },
						summary,
					},
				});
			}
			if (reviewType === "request_changes") {
				await submitHumanFeedbackTrigger({
					body: {
						workspaceId,
						cardId,
						comment: overallFeedback.trim() || undefined,
					},
				});
			} else if (overallFeedback.trim()) {
				await addReviewCommentTrigger({
					body: {
						workspaceId,
						cardId,
						type: "human",
						actor: { type: "human", id: "human" },
						summary: overallFeedback.trim(),
					},
				});
			}
			setPendingComments([]);
			setOverallFeedback("");
			setShowReviewPanel(false);
			onRefresh();
		} finally {
			setSubmitting(false);
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
	const selectedCommitData = commits.find((c) => c.hash === selectedCommit);
	const reviewHasContent = overallFeedback.trim().length > 0 || pendingComments.length > 0;

	// ── Render ────────────────────────────────────────────────────────────────

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

				{/* Commit selector */}
				{commits.length > 0 && (
					<div className="relative" ref={commitDropdownRef}>
						<button
							onClick={() => setShowCommitDropdown((v) => !v)}
							className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1a1a24] border border-[#2a2a38] hover:border-[#3a3a50] text-gray-400 hover:text-gray-200 text-[11px] transition-colors"
						>
							<GitCommit size={11} className="text-gray-500" />
							{selectedCommitData ? (
								<>
									<span className="font-mono text-purple-400">{selectedCommitData.shortHash}</span>
									<span className="text-gray-500 max-w-[120px] truncate">{selectedCommitData.message}</span>
								</>
							) : (
								<span>
									{commits.length} commit{commits.length !== 1 ? "s" : ""}
								</span>
							)}
							<ChevronDown size={10} className="text-gray-600" />
						</button>

						{showCommitDropdown && (
							<div className="absolute top-full left-0 mt-1 z-50 bg-[#13131a] border border-[#2a2a38] rounded-lg shadow-2xl min-w-[320px] overflow-hidden py-1">
								<button
									onClick={() => handleSelectCommit(null)}
									className={classNames(
										"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-[#1a1a24] transition-colors",
										!selectedCommit ? "text-gray-100" : "text-gray-500",
									)}
								>
									<span className="font-mono text-gray-600 w-14 shrink-0 text-left">All</span>
									<span>Show all changes</span>
								</button>
								<div className="h-px bg-[#1e1e28] mx-2 my-1" />
								{commits.map((c) => (
									<button
										key={c.hash}
										onClick={() => handleSelectCommit(c.hash)}
										className={classNames(
											"flex items-center gap-2.5 w-full px-3 py-2 text-[11px] hover:bg-[#1a1a24] transition-colors",
											selectedCommit === c.hash ? "text-gray-100" : "text-gray-400",
										)}
									>
										<span className="font-mono text-purple-400 w-14 shrink-0 text-left">{c.shortHash}</span>
										<span className="flex-1 text-left truncate">{c.message}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}

				<div className="flex-1" />

				<button
					onClick={refreshDiff}
					className="text-gray-600 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
					title="Refresh diff"
				>
					<RefreshCw size={13} />
				</button>

				{/* Submit review dropdown */}
				{isReadyForReview && (
					<div className="relative" ref={reviewDropdownRef}>
						<button
							onClick={() => setShowReviewPanel((v) => !v)}
							className={classNames(
								"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
								showReviewPanel
									? "bg-green-700 text-white"
									: "bg-green-800/60 hover:bg-green-700 border border-green-700/50 text-green-300 hover:text-white",
								pendingComments.length > 0 ? "ring-1 ring-green-500/50" : "",
							)}
						>
							Submit review
							{pendingComments.length > 0 && (
								<span className="bg-green-600 text-white text-[9px] rounded-full px-1.5 py-0 font-bold">
									{pendingComments.length}
								</span>
							)}
							<ChevronDown size={10} />
						</button>

						{showReviewPanel && (
							<div className="absolute top-full right-0 mt-1.5 z-50 w-[400px] font-sans bg-[#13131a] border border-[#2a2a38] rounded-lg shadow-2xl overflow-hidden">
								{/* Dropdown header */}
								<div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a38]">
									<span className="text-sm font-semibold text-gray-100">Finish your review</span>
									<button
										onClick={() => setShowReviewPanel(false)}
										className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
									>
										<X size={14} />
									</button>
								</div>

								<div className="p-4 space-y-3">
									{/* Pending inline comments summary */}
									{pendingComments.length > 0 && (
										<div className="bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-3 py-2">
											<p className="text-xs text-gray-400">
												<span className="font-semibold text-gray-200">{pendingComments.length}</span> pending inline
												comment{pendingComments.length !== 1 ? "s" : ""} staged
											</p>
											<div className="mt-1.5 space-y-0.5 max-h-16 overflow-y-auto">
												{pendingComments.map((c) => (
													<div key={c.id} className="flex items-start gap-1.5 text-[11px]">
														<span className="text-gray-600 font-mono shrink-0">
															{c.file}
															{c.lineNum !== null ? `:${c.lineNum}` : ""}
														</span>
														<span className="text-gray-500 truncate">— {c.text}</span>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Feedback textarea */}
									<div className="rounded-lg border border-[#2a2a38] bg-[#0d0d12] focus-within:border-[#3a3a50] transition-colors">
										<textarea
											autoFocus
											value={overallFeedback}
											onChange={(e) => setOverallFeedback(e.target.value)}
											placeholder="Leave a comment…"
											rows={4}
											className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-2 resize-none outline-none placeholder-gray-600"
										/>
									</div>

									{/* Review type */}
									<div className="border border-[#2a2a38] rounded-lg divide-y divide-[#2a2a38] overflow-hidden">
										<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#1a1a24] transition-colors">
											<input
												type="radio"
												name="review-type"
												value="comment"
												checked={reviewType === "comment"}
												onChange={() => setReviewType("comment")}
												className="mt-0.5 accent-blue-500 shrink-0"
											/>
											<div>
												<p className="text-xs font-semibold text-gray-200">Comment</p>
												<p className="text-[11px] text-gray-500 mt-0.5">
													Submit general feedback without reopening the task.
												</p>
											</div>
										</label>
										<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#1a1a24] transition-colors">
											<input
												type="radio"
												name="review-type"
												value="request_changes"
												checked={reviewType === "request_changes"}
												onChange={() => setReviewType("request_changes")}
												className="mt-0.5 accent-blue-500 shrink-0"
											/>
											<div>
												<p className="text-xs font-semibold text-gray-200">Request changes</p>
												<p className="text-[11px] text-gray-500 mt-0.5">
													Submit feedback and reopen the task for fixes.
												</p>
											</div>
										</label>
									</div>
								</div>

								{/* Dropdown footer */}
								<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2a2a38] bg-[#0f0f16]">
									<Button variant="outlined" size="sm" onClick={() => setShowReviewPanel(false)}>
										Cancel
									</Button>
									<Button
										size="sm"
										disabled={submitting || !reviewHasContent}
										onClick={() => void handleSubmitReview()}
									>
										{submitting ? "Submitting…" : "Submit review"}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}
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
				<div ref={diffScrollRef} className="flex-1 overflow-y-auto overflow-x-auto">
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
										onClick={() => toggleCollapse(path)}
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
										onClick={() =>
											openCommentKey === fileCommentKey ? setOpenCommentKey(null) : openComment(fileCommentKey)
										}
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
										onChange={setCommentDraft}
										onAdd={() => commitPending(path, fileCommentKey, null)}
										onCancel={() => setOpenCommentKey(null)}
									/>
								)}

								{/* File-level pending comments */}
								{filePendingComments
									.filter((c) => c.lineKey === fileCommentKey)
									.map((c) => (
										<PendingCommentBubble key={c.id} comment={c} onSave={saveCommentNow} onRemove={removePending} />
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
															className={classNames(
																"group relative flex hover:brightness-110 transition-[filter]",
																rowBg,
															)}
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
																className={classNames(
																	"flex-1 py-0.5 pr-7 whitespace-pre font-mono text-[12px]",
																	textColor,
																)}
															>
																{line.content}
															</div>
															{/* Hover comment button */}
															<button
																onClick={() =>
																	openCommentKey === lineKey ? setOpenCommentKey(null) : openComment(lineKey)
																}
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
																onChange={setCommentDraft}
																onAdd={() => commitPending(path, lineKey, lineNum)}
																onCancel={() => setOpenCommentKey(null)}
															/>
														)}

														{/* Pending comments on this line */}
														{linePending.map((c) => (
															<PendingCommentBubble
																key={c.id}
																comment={c}
																onSave={saveCommentNow}
																onRemove={removePending}
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
			</div>
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InlineCommentBox({
	draftRef,
	value,
	onChange,
	onAdd,
	onCancel,
}: {
	draftRef: React.RefObject<HTMLTextAreaElement>;
	value: string;
	onChange: (v: string) => void;
	onAdd: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="mx-4 my-2 font-sans">
			<div className="rounded-lg border border-[#2a2a38] bg-[#0d0d12] focus-within:border-[#3a3a50] transition-colors">
				<textarea
					ref={draftRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							onAdd();
						}
						if (e.key === "Escape") onCancel();
					}}
					placeholder="Add a comment…"
					rows={2}
					className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-1 resize-none outline-none placeholder-gray-600"
				/>
				<div className="flex items-center justify-between px-3 pb-2">
					<span className="text-[10px] text-gray-700">↵ Add · ⇧↵ Newline · Esc Cancel</span>
					<Button size="sm" onClick={onAdd} disabled={!value.trim()}>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}

function PendingCommentBubble({
	comment,
	onSave,
	onRemove,
}: {
	comment: PendingComment;
	onSave: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<div className="mx-4 my-1.5 border border-yellow-800/40 rounded-md bg-yellow-950/20 p-2.5 font-sans">
			<div className="flex items-start justify-between gap-2">
				<p className="text-xs text-yellow-200/90 leading-relaxed flex-1">{comment.text}</p>
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={() => onSave(comment.id)}
						className="text-[10px] text-gray-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-blue-600"
						title="Save to Comments tab"
					>
						Save
					</button>
					<button onClick={() => onRemove(comment.id)} className="text-gray-600 hover:text-red-400 transition-colors">
						<X size={11} />
					</button>
				</div>
			</div>
		</div>
	);
}
