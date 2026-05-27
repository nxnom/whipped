import { Button } from "@geckoui/geckoui";
import { AlertTriangle, ChevronDown, ChevronRight, MessageSquare, Plus, RefreshCw, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
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

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
	workspaceId: string;
	cardId: string;
	isReadyForReview: boolean;
	onRefresh: () => void;
}

export function DiffView({ workspaceId, cardId, isReadyForReview, onRefresh }: Props) {
	const [files, setFiles] = useState<DiffFile[]>([]);
	const [baseBehindCount, setBaseBehindCount] = useState(0);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
	const [openCommentKey, setOpenCommentKey] = useState<string | null>(null);
	const [commentDraft, setCommentDraft] = useState("");
	const [overallFeedback, setOverallFeedback] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const draftRef = useRef<HTMLTextAreaElement>(null);

	const load = async () => {
		setLoading(true);
		setLoadError(null);
		try {
			const r = await trpc.cards.getDiff.query({ workspaceId, cardId });
			if (r.error || r.diff === null) {
				setLoadError(r.error ?? "No diff available");
				setFiles([]);
			} else {
				setFiles(r.diff ? parseDiff(r.diff) : []);
				setBaseBehindCount(r.baseBehindCount ?? 0);
			}
		} catch (e: unknown) {
			setLoadError(e instanceof Error ? e.message : "Failed to load diff");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [workspaceId, cardId]);

	const toggleCollapse = (path: string) =>
		setCollapsed((prev) => {
			const n = new Set(prev);
			n.has(path) ? n.delete(path) : n.add(path);
			return n;
		});

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
		try {
			await trpc.cards.addReviewComment.mutate({
				workspaceId,
				cardId,
				type: "human",
				actor: { type: "human", id: "human" },
				summary,
			});
			removePending(id);
			onRefresh();
		} catch {
			/* keep staged on error */
		}
	};

	const handleRequestChanges = async () => {
		if (!overallFeedback.trim() && pendingComments.length === 0) return;
		setSubmitting(true);
		try {
			// Save each inline comment as its own review comment
			for (const c of pendingComments) {
				const summary =
					c.lineNum !== null ? `**${c.file}** (line ${c.lineNum}):\n${c.text}` : `**${c.file}**:\n${c.text}`;
				await trpc.cards.addReviewComment.mutate({
					workspaceId,
					cardId,
					type: "human",
					actor: { type: "human", id: "human" },
					summary,
				});
			}
			// Main message reopens the card (no comment if only inline comments were added)
			await trpc.cards.submitHumanFeedback.mutate({
				workspaceId,
				cardId,
				comment: overallFeedback.trim() || undefined,
			});
			setPendingComments([]);
			setOverallFeedback("");
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
				<button onClick={load} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
					<RefreshCw size={12} /> Retry
				</button>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
				<p className="text-sm">No changes yet</p>
				<button onClick={load} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
					<RefreshCw size={12} /> Refresh
				</button>
			</div>
		);
	}

	const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
	const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div className="flex-1 min-h-0 flex flex-col font-mono text-xs bg-[#0a0a0e]">
			{/* Top bar */}
			<div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-gray-900/60 font-sans">
				<span className="text-gray-400 text-xs">
					{files.length} file{files.length !== 1 ? "s" : ""} changed
					{" · "}
					<span className="text-green-400">+{totalAdditions}</span>{" "}
					<span className="text-red-400">-{totalDeletions}</span>
				</span>
				<button
					onClick={load}
					className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
				>
					<RefreshCw size={13} />
				</button>
			</div>

			{/* Base branch drift notice */}
			{baseBehindCount > 0 && (
				<div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-amber-950/40 border-b border-amber-800/40 font-sans">
					<AlertTriangle size={12} className="text-amber-400 shrink-0" />
					<span className="text-amber-300/90 text-xs">
						Base branch has {baseBehindCount} new commit{baseBehindCount !== 1 ? "s" : ""} not yet in this branch — they
						will be included when merged and are not shown here.
					</span>
				</div>
			)}

			{/* Files */}
			<div className="flex-1 overflow-y-auto overflow-x-auto">
				{files.map((file) => {
					const path = displayPath(file);
					const isCollapsed = collapsed.has(path);
					const fileCommentKey = `${path}:header`;
					const filePendingComments = pendingComments.filter((c) => c.file === path);

					return (
						<div key={path} className="border-b border-gray-800">
							{/* File header */}
							<div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
								<button onClick={() => toggleCollapse(path)} className="text-gray-500 hover:text-gray-300 shrink-0">
									{isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
								</button>
								<span className="flex-1 text-gray-200 text-xs truncate">
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
									<span className="shrink-0 text-[11px]">
										<span className="text-green-400">+{file.additions}</span>{" "}
										<span className="text-red-400">-{file.deletions}</span>
									</span>
								)}
								<button
									onClick={() =>
										openCommentKey === fileCommentKey ? setOpenCommentKey(null) : openComment(fileCommentKey)
									}
									className="shrink-0 text-gray-600 hover:text-blue-400 transition-colors p-0.5 rounded"
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
										<div className="px-2 py-0.5 bg-blue-950/30 text-blue-400/70 border-y border-blue-900/30 whitespace-pre">
											{hunk.header}
										</div>

										{/* Lines */}
										{hunk.lines.map((line, li) => {
											const lineNum = line.newNum ?? line.oldNum;
											const lineKey = `${path}:${lineNum}`;
											const linePending = pendingComments.filter((c) => c.lineKey === lineKey);

											const rowBg =
												line.type === "added" ? "bg-[#0d2a0d]" : line.type === "removed" ? "bg-[#2a0d0d]" : "";
											const numBg =
												line.type === "added"
													? "bg-[#163d16]"
													: line.type === "removed"
														? "bg-[#3d1616]"
														: "bg-transparent";
											const numColor =
												line.type === "added"
													? "text-green-700"
													: line.type === "removed"
														? "text-red-700"
														: "text-gray-700";
											const sign = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
											const signColor =
												line.type === "added"
													? "text-green-500"
													: line.type === "removed"
														? "text-red-500"
														: "text-transparent";
											const textColor = line.type === "context" ? "text-gray-500" : "text-gray-200";

											return (
												<div key={li}>
													{/* Line row */}
													<div className={classNames("group relative flex hover:brightness-110", rowBg)}>
														{/* Single line number column */}
														<div
															className={classNames(
																"w-8 shrink-0 text-right pr-1.5 py-0.5 select-none border-r border-gray-800",
																numBg,
																numColor,
															)}
														>
															{line.newNum ?? line.oldNum ?? ""}
														</div>
														{/* Sign */}
														<div className="w-4 shrink-0 text-center py-0.5 select-none">
															<span className={signColor}>{sign}</span>
														</div>
														<div className={classNames("flex-1 py-0.5 pr-7 whitespace-pre", textColor)}>
															{line.content}
														</div>
														{/* Hover comment button */}
														<button
															onClick={() =>
																openCommentKey === lineKey ? setOpenCommentKey(null) : openComment(lineKey)
															}
															className="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:text-blue-400 p-0.5 rounded"
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
								<div className="px-4 py-3 text-gray-500 italic">Binary file changed</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Always-visible review box */}
			<div className="shrink-0 border-t border-gray-800 font-sans p-3">
				{/* Pending inline comments summary */}
				{pendingComments.length > 0 && (
					<div className="mb-2 space-y-0.5 max-h-20 overflow-y-auto">
						{pendingComments.map((c) => (
							<div key={c.id} className="flex items-start gap-1.5 text-xs">
								<span className="text-gray-600 shrink-0">•</span>
								<span className="text-gray-500 shrink-0 font-mono">
									{c.file}
									{c.lineNum !== null ? `:${c.lineNum}` : ""}
								</span>
								<span className="text-gray-300 truncate">— {c.text}</span>
							</div>
						))}
					</div>
				)}

				<div className="rounded-lg border border-gray-700 bg-gray-900 focus-within:border-gray-600 transition-colors">
					<textarea
						value={overallFeedback}
						onChange={(e) => setOverallFeedback(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !pendingComments.length) {
								e.preventDefault();
								void (async () => {
									if (!overallFeedback.trim()) return;
									setSubmitting(true);
									try {
										await trpc.cards.addReviewComment.mutate({
											workspaceId,
											cardId,
											type: "human",
											actor: { type: "human", id: "human" },
											summary: overallFeedback.trim(),
										});
										setOverallFeedback("");
										onRefresh();
									} finally {
										setSubmitting(false);
									}
								})();
							}
						}}
						placeholder="Leave a review comment…"
						rows={2}
						className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-1 resize-none outline-none placeholder-gray-600"
					/>
					<div className="flex items-center justify-between px-3 pb-2">
						<span className="text-[10px] text-gray-700">
							{pendingComments.length > 0
								? `${pendingComments.length} inline comment${pendingComments.length !== 1 ? "s" : ""} staged · ⇧↵ Newline`
								: "↵ Send · ⇧↵ Newline"}
						</span>
						<div className="flex gap-1.5">
							{isReadyForReview && (
								<Button
									variant="outlined"
									size="sm"
									disabled={submitting || (!pendingComments.length && !overallFeedback.trim())}
									onClick={handleRequestChanges}
								>
									{submitting ? "Submitting…" : "Request Changes"}
								</Button>
							)}
							<Button
								size="sm"
								disabled={submitting || !overallFeedback.trim()}
								onClick={async () => {
									if (!overallFeedback.trim()) return;
									setSubmitting(true);
									try {
										await trpc.cards.addReviewComment.mutate({
											workspaceId,
											cardId,
											type: "human",
											actor: { type: "human", id: "human" },
											summary: overallFeedback.trim(),
										});
										setOverallFeedback("");
										onRefresh();
									} finally {
										setSubmitting(false);
									}
								}}
							>
								<Send size={11} className="mr-1" />
								Send
							</Button>
						</div>
					</div>
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
			<div className="rounded-lg border border-gray-700 bg-gray-900 focus-within:border-gray-600 transition-colors">
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
					<button
						onClick={() => onRemove(comment.id)}
						className="text-gray-600 hover:text-red-400 transition-colors"
						title="Remove"
					>
						<X size={11} />
					</button>
				</div>
			</div>
		</div>
	);
}
