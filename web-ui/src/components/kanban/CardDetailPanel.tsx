import { Button, ConfirmDialog, Input, Tooltip, toast } from "@geckoui/geckoui";
import type { WorkflowSlot, RuntimeBoardCard } from "@runtime-contract";
import { ArrowLeft, Check, ExternalLink, GitBranch, GitMerge, GitPullRequest, Paperclip, Pencil, Play, Square, TerminalSquare, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { attachmentUrl, uploadAttachmentFile } from "@/runtime/attachments";
import { trpc } from "@/runtime/trpc-client";
import { useRunSession } from "@/stores/run-session-store";
import { ChatComments } from "./ChatComments";
import { DiffView } from "./DiffView";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	onClose: () => void;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
	urgent: "text-red-400 bg-red-400/10 border-red-400/20",
	high: "text-orange-400 bg-orange-400/10 border-orange-400/20",
	medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
	low: "text-slate-400 bg-slate-400/10 border-slate-400/20",
};

const COLUMN_LABELS: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

const DEP_COL_BADGE: Record<string, string> = {
	todo: "text-gray-400 bg-gray-700",
	in_progress: "text-blue-400 bg-blue-400/10",
	reopened: "text-orange-400 bg-orange-400/10",
	ready_for_review: "text-green-400 bg-green-400/10",
	blocked: "text-red-400 bg-red-400/10",
	done: "text-emerald-400 bg-emerald-400/10",
};

const BUILTIN_SESSION_LABELS: Record<string, string> = {
	dev: "Dev",
	"code-review": "Code Review",
	code_review: "Code Review",
	qa: "QA",
	conflict: "Conflict",
	cascade: "Cascade",
};

function getSessionLabel(type: string, workflowSlots?: WorkflowSlot[]): string {
	if (BUILTIN_SESSION_LABELS[type]) return BUILTIN_SESSION_LABELS[type];
	const slot = workflowSlots?.find(s => s.id === type);
	if (slot) return slot.name;
	return type;
}

const MIN_SIDEBAR = 340;
const MAX_SIDEBAR = 520;
const DEFAULT_SIDEBAR = 340;

type SidebarTab = "overview" | "activity";
type RightTab = "terminal" | "diff" | "comments";

function DescAttachment({ path, name, mimeType }: { path: string; name: string; mimeType?: string }) {
	const [expanded, setExpanded] = useState(false);
	const isImage = (mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
	if (isImage) {
		return (
			<div className="relative group">
				<img
					src={attachmentUrl(path)}
					alt={name}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Click to collapse" : name}
					className={`rounded border border-gray-700 cursor-pointer object-contain ${expanded ? "max-w-full max-h-64" : "h-16 w-16 object-cover"}`}
				/>
			</div>
		);
	}
	return (
		<a
			href={attachmentUrl(path)}
			target="_blank"
			rel="noreferrer"
			title={name}
			className="flex items-center gap-1.5 px-2 py-1 rounded border border-gray-700 bg-gray-800 text-xs text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors max-w-[160px] truncate"
		>
			<Paperclip size={11} className="shrink-0" />{name}
		</a>
	);
}

export function CardDetailPanel({ card, workspaceId, allCards, workflowSlots, onClose, onRefresh, onDeleteCard }: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);
	const [merging, setMerging] = useState(false);
	const [creatingPR, setCreatingPR] = useState(false);
	const [activeTab, setActiveTab] = useState<SidebarTab>("overview");
	const [rightTab, setRightTab] = useState<RightTab>("terminal");
	const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
	const [uploadingDesc, setUploadingDesc] = useState(false);
	const [descExpanded, setDescExpanded] = useState(false);
	const [editingBranch, setEditingBranch] = useState(false);
	const [branchInput, setBranchInput] = useState("");
	const [savingBranch, setSavingBranch] = useState(false);
	const descFileInputRef = useRef<HTMLInputElement>(null);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	const isStory = card.type === "story";
	const isReadyForReview = card.columnId === "ready_for_review";

	// Story cards have a synthetic dev session/comment that is an implementation
	// detail — hide it so the user only sees the real orch sessions/comments.
	const visibleSessions = isStory
		? (card.terminalSessions ?? []).filter((ts) => ts.type !== "dev")
		: (card.terminalSessions ?? []);
	const commentCount = isStory
		? (card.reviewComments ?? []).filter((c) => c.type !== "dev").length
			+ (card.dependsOn ?? []).reduce((sum, depId) => sum + (allCards?.[depId]?.reviewComments?.length ?? 0), 0)
		: (card.reviewComments?.length ?? 0);


	// ── Resize drag handle ─────────────────────────────────────────────────
	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragRef.current) return;
			setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, dragRef.current.startWidth + e.clientX - dragRef.current.startX)));
		};
		const onMouseUp = () => { dragRef.current = null; };
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	const onDragStart = (e: React.MouseEvent) => {
		dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
		e.preventDefault();
	};

	// ── Session tracking ───────────────────────────────────────────────────
	const prevCardIdRef = useRef(card.id);
	useEffect(() => {
		if (card.id !== prevCardIdRef.current) {
			prevCardIdRef.current = card.id;
			setActiveStreamId(card.terminalSessions?.at(-1)?.streamId ?? card.id);
			prevSessionLenRef.current = card.terminalSessions?.length ?? 0;
			setRightTab("terminal");
		}
	}, [card.id]);

	const prevSessionLenRef = useRef(card.terminalSessions?.length ?? 0);
	useEffect(() => {
		const sessions = card.terminalSessions ?? [];
		if (sessions.length > prevSessionLenRef.current) {
			const latest = sessions.at(-1);
			if (latest) setActiveStreamId(latest.streamId);
		}
		prevSessionLenRef.current = sessions.length;
	}, [card.terminalSessions?.length]);

	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const activeTerminalSession = card.terminalSessions?.find((ts) => !ts.endedAt);
	const hasTerminalOutput = visibleSessions.length > 0;

	const { session: runSession, start: startRun } = useRunSession(workspaceId);
	const isThisCardRunning = runSession.status === "running" && runSession.cardId === card.id;

	const handleRunTicket = async () => {
		try {
			await startRun(card.id);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(msg);
		}
	};

	// ── Handlers ───────────────────────────────────────────────────────────
	const handleStart = async () => {
		try {
			await trpc.cards.startAgent.mutate({ workspaceId, cardId: card.id });
			onRefresh();
		} catch {
			toast.error("Failed to start agent");
		}
	};

	const handleStop = () => {
		ConfirmDialog.show({
			title: "Stop agent?",
			content: "The agent will be interrupted. You can restart it later.",
			confirmButtonLabel: "Stop",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					await trpc.cards.stopAgent.mutate({ workspaceId, cardId: card.id });
					dismiss();
					onRefresh();
				} catch {
					toast.error("Failed to stop agent");
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCommitAndMerge = () => {
		ConfirmDialog.show({
			title: `Merge into ${card.baseRef}?`,
			content: "Commits any pending changes and merges the task branch directly. This cannot be undone.",
			confirmButtonLabel: "Merge",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				setMerging(true);
				try {
					const result = await trpc.cards.commitAndMerge.mutate({ workspaceId, cardId: card.id });
					if (result.status === "merged") {
						toast.success(`Merged into ${card.baseRef}`);
						onRefresh();
						onClose();
					} else {
						toast.success("Merge conflicts detected — resolving with AI agent...");
						onRefresh();
					}
				} catch (err: unknown) {
					toast.error(`Merge failed: ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setMerging(false);
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCommitAndPR = () => {
		ConfirmDialog.show({
			title: "Create Pull Request?",
			content: `Commits any pending changes, pushes the branch, and opens a PR against ${card.baseRef}.`,
			confirmButtonLabel: "Create PR",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				setCreatingPR(true);
				try {
					const result = await trpc.cards.commitAndPR.mutate({ workspaceId, cardId: card.id });
					if (result.status === "no_token") {
						toast.error("GitHub token not configured — add GITHUB_TOKEN in project Settings > Secrets.");
						return;
					}
					toast.success("PR created");
					window.open(result.prUrl, "_blank");
					onRefresh();
				} catch (err: unknown) {
					toast.error(`PR creation failed: ${err instanceof Error ? err.message : String(err)}`);
				} finally {
					setCreatingPR(false);
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleDescriptionAttach = async (files: FileList) => {
		const imageFiles = Array.from(files);
		if (imageFiles.length === 0) return;
		setUploadingDesc(true);
		try {
			const newAttachments = [];
			for (const file of imageFiles) {
				newAttachments.push(await uploadAttachmentFile(workspaceId, card.id, file));
			}
			const existing = card.descriptionAttachments ?? [];
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				descriptionAttachments: [...existing, ...newAttachments],
				revision: 0,
			});
			onRefresh();
		} catch {
			toast.error("Failed to upload image");
		} finally {
			setUploadingDesc(false);
		}
	};

	const handleRemoveDescAttachment = async (idx: number) => {
		const existing = card.descriptionAttachments ?? [];
		await trpc.cards.update.mutate({
			workspaceId,
			cardId: card.id,
			descriptionAttachments: existing.filter((_, i) => i !== idx),
			revision: 0,
		});
		onRefresh();
	};

	const currentBranch = card.branchName ?? `kanbom/task-${card.id}`;
	const canEditBranch = !card.worktreePath;

	const startEditBranch = () => {
		setBranchInput(card.branchName ?? "");
		setEditingBranch(true);
	};

	const cancelEditBranch = () => {
		setEditingBranch(false);
		setBranchInput("");
	};

	const saveBranchName = async () => {
		const next = branchInput.trim();
		if (next === (card.branchName ?? "")) {
			cancelEditBranch();
			return;
		}
		setSavingBranch(true);
		try {
			await trpc.cards.update.mutate({
				workspaceId,
				cardId: card.id,
				branchName: next || undefined,
				revision: 0,
			});
			toast.success("Branch name updated");
			cancelEditBranch();
			onRefresh();
		} catch {
			toast.error("Failed to update branch name");
		} finally {
			setSavingBranch(false);
		}
	};

	const handleDelete = () => {
		ConfirmDialog.show({
			title: "Delete task?",
			content: "This cannot be undone.",
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				try {
					onDeleteCard(card.id);
					dismiss();
					onClose();
					await trpc.cards.delete.mutate({ workspaceId, cardId: card.id });
					onRefresh();
				} catch {
					toast.error("Failed to delete task");
					onRefresh(); // revert optimistic update on failure
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};


	return (
		<div className="absolute inset-0 z-10 bg-gray-950 flex overflow-hidden">
			{/* ── Sidebar ──────────────────────────────────────────────── */}
			<div
				className="shrink-0 border-r border-gray-800 flex flex-col"
				style={{ width: sidebarWidth }}
			>
				{/* Header */}
				<div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800 shrink-0">
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-800"
						title="Back to board"
					>
						<ArrowLeft size={16} />
					</button>
					<span className="text-xs text-gray-400 truncate flex-1 font-medium">{card.title}</span>
					{isRunning && (
						<span className="size-1.5 rounded-full shrink-0 bg-blue-400 animate-pulse" />
					)}
					{!isThisCardRunning && (
						<button
							onClick={handleRunTicket}
							className="p-1 rounded text-gray-500 hover:text-emerald-400 hover:bg-gray-800 transition-colors"
							title="Run this ticket's start command"
						>
							<Play size={13} />
						</button>
					)}
					<button
						onClick={handleDelete}
						className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors"
						title="Delete this task"
					>
						<Trash2 size={13} />
					</button>
				</div>

				{/* Tab bar */}
				<div className="flex border-b border-gray-800 shrink-0">
					{(["overview", "activity"] as SidebarTab[]).map((tab) => (
						<button
							key={tab}
							onClick={() => setActiveTab(tab)}
							className={`flex-1 py-2 text-xs font-medium transition-colors relative ${
								activeTab === tab ? "text-gray-100" : "text-gray-500 hover:text-gray-300"
							}`}
						>
							{tab.charAt(0).toUpperCase() + tab.slice(1)}
							{activeTab === tab && (
								<span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />
							)}
						</button>
					))}
				</div>

				{/* Tab content */}
				<div className="flex-1 min-h-0 flex flex-col">
					{/* ── Overview tab ── */}
					{activeTab === "overview" && (
						<div className="flex-1 overflow-y-auto p-4 space-y-4">
							<div>
								<h2 className="text-sm font-semibold text-gray-100 leading-snug">{card.title}</h2>
								{isRunning && (
									<p className="text-xs text-gray-500 mt-1">
										{activeTerminalSession?.agentId} · Running
									</p>
								)}
								{card.worktreePath && (
									<button
										onClick={() => trpc.fs.openTerminal.mutate({ path: card.worktreePath! })}
										className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 cursor-pointer transition-colors"
										title="Open terminal at worktree"
									>
										<TerminalSquare size={12} />
										<span className="font-mono truncate max-w-[220px]">{card.worktreePath.split("/").slice(-2).join("/")}</span>
									</button>
								)}
								{card.baseRef && (
									<div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
										<GitBranch size={11} className="shrink-0" />
										{editingBranch ? (
											<div className="flex items-center gap-1 flex-1 min-w-0">
												<Input
													autoFocus
													value={branchInput}
													onChange={(e) => setBranchInput(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Enter") void saveBranchName();
														if (e.key === "Escape") cancelEditBranch();
													}}
													placeholder={`kanbom/task-${card.id}`}
													disabled={savingBranch}
												/>
												<button
													onClick={() => void saveBranchName()}
													disabled={savingBranch}
													className="p-1 rounded text-gray-500 hover:text-emerald-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
													title="Save branch name"
												>
													<Check size={12} />
												</button>
												<button
													onClick={cancelEditBranch}
													disabled={savingBranch}
													className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors disabled:opacity-50"
													title="Cancel"
												>
													<X size={12} />
												</button>
											</div>
										) : (
											<>
												<span className="font-mono text-gray-400 truncate max-w-[140px]" title={currentBranch}>{currentBranch}</span>
												{canEditBranch && (
													<button
														onClick={startEditBranch}
														className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
														title="Edit branch name"
													>
														<Pencil size={11} />
													</button>
												)}
												<span className="text-gray-600">→</span>
												<span className="font-mono text-gray-400 truncate max-w-[140px]">{card.baseRef}</span>
											</>
										)}
									</div>
								)}
							</div>

							{card.description && (
								<div>
									<p className={`text-xs text-gray-400 whitespace-pre-wrap leading-relaxed ${descExpanded ? "" : "line-clamp-4"}`}>
										{card.description}
									</p>
									{card.description.split("\n").length > 4 || card.description.length > 240 ? (
										<button
											onClick={() => setDescExpanded((v) => !v)}
											className="mt-1 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
										>
											{descExpanded ? "Show less" : "Show more"}
										</button>
									) : null}
								</div>
							)}

							{/* Description attachments */}
							<div>
								<input
									ref={descFileInputRef}
									type="file"
									accept="*/*"
									multiple
									className="hidden"
									onChange={(e) => { if (e.target.files) void handleDescriptionAttach(e.target.files); e.target.value = ""; }}
								/>
								{(card.descriptionAttachments?.length ?? 0) > 0 && (() => {
									const isImg = (att: { mimeType?: string; name: string }) =>
										(att.mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
									const indexed = (card.descriptionAttachments ?? []).map((att, idx) => ({ att, idx }));
									const imgs = indexed.filter(({ att }) => isImg(att));
									const files = indexed.filter(({ att }) => !isImg(att));
									const RemoveBtn = ({ idx }: { idx: number }) => (
										<button
											onClick={() => void handleRemoveDescAttachment(idx)}
											className="absolute -top-1 -right-1 size-4 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
										>
											<X size={10} className="text-gray-300" />
										</button>
									);
									return (
										<div className="flex flex-col gap-1.5 mb-2">
											{imgs.length > 0 && (
												<div className="flex flex-wrap gap-2">
													{imgs.map(({ att, idx }) => (
														<div key={idx} className="relative group">
															<DescAttachment path={att.path} name={att.name} mimeType={att.mimeType} />
															<RemoveBtn idx={idx} />
														</div>
													))}
												</div>
											)}
											{files.length > 0 && (
												<div className="flex flex-wrap gap-1.5">
													{files.map(({ att, idx }) => (
														<div key={idx} className="relative group inline-flex">
															<DescAttachment path={att.path} name={att.name} mimeType={att.mimeType} />
															<RemoveBtn idx={idx} />
														</div>
													))}
												</div>
											)}
										</div>
									);
								})()}
								<button
									onClick={() => descFileInputRef.current?.click()}
									disabled={uploadingDesc}
									className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-50"
								>
									<Paperclip size={12} />
									{uploadingDesc ? "Uploading…" : "Attach file"}
								</button>
							</div>

							{/* Priority */}
							{card.priority && (
								<div>
									<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Priority</h4>
									<span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${PRIORITY_STYLES[card.priority] ?? "text-gray-400 bg-gray-700/30 border-gray-700"}`}>
										{card.priority.charAt(0).toUpperCase() + card.priority.slice(1)}
									</span>
								</div>
							)}

							{/* Dependencies */}
							{(card.dependsOn ?? []).length > 0 && (
								<div>
									<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Dependencies</h4>
									<div className="space-y-1">
										{(card.dependsOn ?? []).map((depId) => {
											const dep = allCards?.[depId];
											if (!dep) return null;
											return (
												<div key={depId} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-gray-800/50 border border-gray-800">
													<span className="text-xs text-gray-300 truncate">{dep.title}</span>
													<span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${DEP_COL_BADGE[dep.columnId] ?? "text-gray-400 bg-gray-700"}`}>
														{COLUMN_LABELS[dep.columnId] ?? dep.columnId}
													</span>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{(card.githubIssueUrl || card.githubPrUrl || card.jiraUrl) && (
								<div className="space-y-1.5">
									{card.githubIssueUrl && (
										<a href={card.githubIssueUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
											<ExternalLink size={11} /> GitHub Issue
										</a>
									)}
									{card.githubPrUrl && (
										<a href={card.githubPrUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300">
											<ExternalLink size={11} /> Pull Request
										</a>
									)}
									{card.jiraUrl && (
										<a href={card.jiraUrl} target="_blank" rel="noreferrer"
											className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300">
											<ExternalLink size={11} /> {card.jiraKey}
										</a>
									)}
								</div>
							)}

							{visibleSessions.length > 0 && (
								<div>
									<h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Sessions</h4>
									<div className="space-y-1">
										{visibleSessions.map((ts) => {
											const isActive = !ts.endedAt;
											const isSelected = activeStreamId === ts.streamId;
											const tsState = isActive ? "running" : ts.state;
											const stateColor =
												tsState === "running" ? "bg-blue-400 animate-pulse" :
												tsState === "failed" ? "bg-red-400" :
												tsState === "stopped" ? "bg-yellow-400" :
												tsState === "completed" ? "bg-green-400" : "bg-gray-400";

											return (
												<button
													key={ts.streamId}
													onClick={() => { setActiveStreamId(ts.streamId); setRightTab("terminal"); }}
													className={`w-full text-left rounded text-xs flex items-center gap-2 transition-colors ${
														isActive
															? `px-2 py-1.5 ${isSelected ? "bg-gray-800 text-gray-100" : "text-gray-300 hover:text-gray-100 hover:bg-gray-800/50"}`
															: `px-2 py-1.5 ${isSelected ? "bg-gray-800 text-gray-100" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"}`
													}`}
												>
													{isActive ? (
														<span className={`size-1.5 rounded-full shrink-0 ${stateColor}`} />
													) : (
														<span className={`size-1.5 rounded-full shrink-0 ${stateColor}`} />
													)}
													<span className="flex-1">{getSessionLabel(ts.type, workflowSlots)}</span>
													{isActive ? (
														<span className="text-[10px] text-blue-400 font-medium">Running</span>
													) : (
														<span className="text-gray-600 tabular-nums">
															{new Date(ts.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
														</span>
													)}
												</button>
											);
										})}
									</div>
								</div>
							)}
						</div>
					)}

					{/* ── Activity tab ── */}
					{activeTab === "activity" && (
						<div className="flex-1 overflow-y-auto p-4">
							{!card.activityLog?.length ? (
								<p className="text-xs text-gray-600 text-center py-8">No activity yet</p>
							) : (
								<div className="space-y-1.5">
									{card.activityLog.map((entry, i) => (
										<div key={i} className="flex items-baseline gap-2 text-xs">
											<span className="text-gray-600 shrink-0 tabular-nums">
												{new Date(entry.timestamp).toLocaleTimeString([], {
													hour: "2-digit",
													minute: "2-digit",
													second: "2-digit",
												})}
											</span>
											<span className="text-gray-400">{entry.message}</span>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer actions */}
				<div className="border-t border-gray-800 p-3 flex items-center justify-end gap-2 shrink-0">
					{isStory ? (
						isRunning && (
							<Tooltip content="Interrupt the running agent" side="top" triggerAsChild>
								<Button variant="outlined" size="sm" onClick={handleStop}>
									<Square size={12} className="mr-1" /> Stop
								</Button>
							</Tooltip>
						)
					) : isReadyForReview ? (
						<div className="flex gap-1.5">
							<Tooltip content={`Commit & merge directly into ${card.baseRef}`} side="top" triggerAsChild>
								<Button variant="outlined" size="sm" onClick={handleCommitAndMerge} disabled={merging || creatingPR}>
									<GitMerge size={12} className="mr-1" />
									{merging ? "Merging..." : `→ ${card.baseRef}`}
								</Button>
							</Tooltip>
							{card.githubPrUrl ? (
								<Tooltip content="Open Pull Request" side="top" triggerAsChild>
									<a
										href={card.githubPrUrl}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 hover:border-green-500/50 transition-colors"
									>
										<GitPullRequest size={12} />
										View PR
										<ExternalLink size={10} />
									</a>
								</Tooltip>
							) : (
								<Tooltip content={`Push & open a PR against ${card.baseRef}`} side="top" triggerAsChild>
									<Button size="sm" onClick={handleCommitAndPR} disabled={merging || creatingPR}>
										<GitPullRequest size={12} className="mr-1" />
										{creatingPR ? "Creating..." : "PR"}
									</Button>
								</Tooltip>
							)}
						</div>
					) : isRunning ? (
						<Tooltip content="Interrupt the running agent" side="top" triggerAsChild>
							<Button variant="outlined" size="sm" onClick={handleStop}>
								<Square size={12} className="mr-1" /> Stop
							</Button>
						</Tooltip>
					) : (
						<Tooltip content="Start the AI agent on this task" side="top" triggerAsChild>
							<Button size="sm" onClick={handleStart}>
								<Play size={12} className="mr-1" /> Start Agent
							</Button>
						</Tooltip>
					)}
				</div>
			</div>

			{/* ── Drag handle ──────────────────────────────────────────── */}
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors bg-gray-800"
			/>

			{/* ── Right panel ───────────────────────────────────────────── */}
			<div className="flex-1 min-w-0 flex flex-col bg-[#030712]">
				{/* Tab bar */}
				<div className="shrink-0 flex items-center border-b border-gray-800 bg-gray-900/40">
					<button
						onClick={() => setRightTab("terminal")}
						className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
							rightTab === "terminal"
								? "text-gray-100 border-blue-500"
								: "text-gray-500 hover:text-gray-300 border-transparent"
						}`}
					>
						<TerminalSquare size={11} /> Terminal
					</button>
					{!isStory && (
						<button
							onClick={() => setRightTab("diff")}
							className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
								rightTab === "diff"
									? "text-gray-100 border-blue-500"
									: "text-gray-500 hover:text-gray-300 border-transparent"
							}`}
						>
							<GitBranch size={11} /> Diff
						</button>
					)}
					<button
						onClick={() => setRightTab("comments")}
						className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 ${
							rightTab === "comments"
								? "text-gray-100 border-blue-500"
								: "text-gray-500 hover:text-gray-300 border-transparent"
						}`}
					>
						Comments{commentCount > 0 ? ` (${commentCount})` : ""}
					</button>

					</div>

				{/* Terminal view */}
				{rightTab === "terminal" && (
					hasTerminalOutput ? (
						<TaskTerminal
							key={activeStreamId}
							taskId={activeStreamId}
							workspaceId={workspaceId}
							className="flex-1"
						/>
					) : (
						<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-600">
							<span className="text-4xl">⌨</span>
							<p className="text-sm">No agent output yet</p>
							<p className="text-xs">Start the agent to see terminal output here</p>
						</div>
					)
				)}

				{/* Diff view */}
				{rightTab === "diff" && (
					<DiffView
						workspaceId={workspaceId}
						cardId={card.id}
						isReadyForReview={isReadyForReview}
						onRefresh={onRefresh}
					/>
				)}

				{/* Comments view */}
				{rightTab === "comments" && (
					<ChatComments
						card={card}
						workspaceId={workspaceId}
						allCards={allCards}
						workflowSlots={workflowSlots}
						onRefresh={onRefresh}
					/>
				)}
			</div>
		</div>
	);
}
