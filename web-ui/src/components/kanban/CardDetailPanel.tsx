import { Button, ConfirmDialog, Dialog, Input, Tooltip, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	ChevronRight,
	Circle,
	Clock,
	ExternalLink,
	FolderOpen,
	GitBranch,
	GitMerge,
	GitPullRequest,
	Paperclip,
	Pencil,
	Play,
	Square,
	TerminalSquare,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { attachmentUrl, uploadAttachmentFile } from "@/runtime/attachments";
import { trpc } from "@/runtime/trpc-client";
import { ChatComments } from "./ChatComments";
import { DiffView } from "./DiffView";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	projectName?: string;
	onClose: () => void;
	onRefresh: () => void;
	onDeleteCard: (cardId: string) => void;
}

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
	if (BUILTIN_SESSION_LABELS[type]) return BUILTIN_SESSION_LABELS[type]!;
	const slot = workflowSlots?.find((s) => s.id === type);
	if (slot) return slot.name;
	return type;
}

const COLUMN_STATUS: Record<string, { label: string; color: string; bg: string; border: string; dotColor: string; glow?: string }> = {
	todo: { label: "Todo", color: "text-gray-400", bg: "bg-gray-400/10", border: "border-gray-400/25", dotColor: "bg-gray-400" },
	in_progress: { label: "In Progress", color: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10", border: "border-[#3b82f6]/25", dotColor: "bg-[#3b82f6]", glow: "#3b82f660" },
	reopened: { label: "Reopened", color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/25", dotColor: "bg-orange-400" },
	ready_for_review: { label: "Ready for Review", color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/25", dotColor: "bg-yellow-400" },
	blocked: { label: "Blocked", color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/25", dotColor: "bg-red-400" },
	done: { label: "Done", color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25", dotColor: "bg-emerald-400" },
};

const PRIORITY_BADGE: Record<string, { color: string; bg: string; border: string; dotColor: string }> = {
	urgent: { color: "text-[#ef4444]", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/25", dotColor: "bg-[#ef4444]" },
	high: { color: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/25", dotColor: "bg-orange-400" },
	medium: { color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/25", dotColor: "bg-yellow-400" },
	low: { color: "text-slate-400", bg: "bg-slate-400/10", border: "border-slate-400/25", dotColor: "bg-slate-400" },
};

const AGENT_DISPLAY: Record<string, { label: string; color: string; bg: string; border: string; dotColor: string }> = {
	claude: { label: "Claude", color: "text-[#7c6aff]", bg: "bg-[#7c6aff]/10", border: "border-[#7c6aff]/25", dotColor: "bg-[#7c6aff]" },
	codex: { label: "Codex", color: "text-[#22c55e]", bg: "bg-[#22c55e]/10", border: "border-[#22c55e]/25", dotColor: "bg-[#22c55e]" },
	cursor: { label: "Cursor", color: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10", border: "border-[#3b82f6]/25", dotColor: "bg-[#3b82f6]" },
	opencode: { label: "Opencode", color: "text-[#f97316]", bg: "bg-[#f97316]/10", border: "border-[#f97316]/25", dotColor: "bg-[#f97316]" },
};

function formatElapsed(sec: number): string {
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

function slotDuration(startedAt: string | number, endedAt?: string | number | null): string {
	const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
	const sec = Math.floor((endMs - new Date(startedAt).getTime()) / 1000);
	return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, "0")}s`;
}

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
					className={`rounded border border-[#2a2a35] cursor-pointer object-contain ${expanded ? "max-w-full max-h-64" : "h-16 w-16 object-cover"}`}
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
			className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#2a2a35] bg-[#1a1a1f] text-xs text-gray-300 hover:text-gray-100 hover:border-[#3a3a48] transition-colors max-w-[160px] truncate"
		>
			<Paperclip size={11} className="shrink-0" />
			{name}
		</a>
	);
}

function CommitMsgDialog({
	dismiss,
	action,
	onSubmit,
}: {
	dismiss: () => void;
	action: "merge" | "pr";
	onSubmit: (msg: string) => void;
}) {
	const [msg, setMsg] = useState("");
	const handleSubmit = () => {
		if (!msg.trim()) return;
		dismiss();
		onSubmit(msg.trim());
	};
	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-base font-semibold text-gray-100">Commit pending changes</h3>
				<p className="text-sm text-gray-400 mt-1">
					There are uncommitted changes. Enter a commit message to proceed.
				</p>
			</div>
			<Input
				placeholder="Commit message"
				value={msg}
				onChange={(e) => setMsg(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleSubmit();
					if (e.key === "Escape") dismiss();
				}}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button variant="outlined" size="sm" onClick={dismiss}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSubmit} disabled={!msg.trim()}>
					{action === "merge" ? "Commit & Merge" : "Commit & Create PR"}
				</Button>
			</div>
		</div>
	);
}

export function CardDetailPanel({
	card,
	workspaceId,
	allCards,
	workflowSlots,
	projectName,
	onClose,
	onRefresh,
	onDeleteCard,
}: Props) {
	const [activeStreamId, setActiveStreamId] = useState<string>(
		() => card.terminalSessions?.at(-1)?.streamId ?? card.id,
	);
	const [merging, setMerging] = useState(false);
	const [creatingPR, setCreatingPR] = useState(false);
	const [rightTab, setRightTab] = useState<RightTab>("terminal");
	const [uploadingDesc, setUploadingDesc] = useState(false);
	const [descExpanded, setDescExpanded] = useState(false);
	const [editingBranch, setEditingBranch] = useState(false);
	const [branchInput, setBranchInput] = useState("");
	const [savingBranch, setSavingBranch] = useState(false);
	const [elapsedSec, setElapsedSec] = useState(0);
	const [activityExpanded, setActivityExpanded] = useState(false);
	const descFileInputRef = useRef<HTMLInputElement>(null);

	const isStory = card.type === "story";
	const isReadyForReview = card.columnId === "ready_for_review";

	const visibleSessions = isStory
		? (card.terminalSessions ?? []).filter((ts) => ts.type !== "dev")
		: (card.terminalSessions ?? []);

	const commentCount = isStory
		? (card.reviewComments ?? []).filter((c) => c.type !== "dev").length +
			(card.dependsOn ?? []).reduce((sum, depId) => sum + (allCards?.[depId]?.reviewComments?.length ?? 0), 0)
		: (card.reviewComments?.length ?? 0);

	const isRunning = card.terminalSessions?.some((ts) => !ts.endedAt) ?? false;
	const activeTerminalSession = card.terminalSessions?.find((ts) => !ts.endedAt);
	const hasTerminalOutput = visibleSessions.length > 0;
	const agentId = activeTerminalSession?.agentId ?? card.agentId ?? null;

	// ── Elapsed timer ──────────────────────────────────────────────────────
	useEffect(() => {
		if (!isRunning || !activeTerminalSession) { setElapsedSec(0); return; }
		const update = () => setElapsedSec(Math.floor((Date.now() - new Date(activeTerminalSession.startedAt as string | number).getTime()) / 1000));
		update();
		const id = setInterval(update, 1000);
		return () => clearInterval(id);
	}, [isRunning, activeTerminalSession?.startedAt]);

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

	const showCommitMsgDialog = (onSubmit: (msg: string) => void, action: "merge" | "pr") => {
		setTimeout(() => {
			Dialog.show({
				className: "max-w-md w-full",
				dismissOnOutsideClick: true,
				content: ({ dismiss }) => <CommitMsgDialog dismiss={dismiss} action={action} onSubmit={onSubmit} />,
			});
		}, 400);
	};

	const doMerge = async (commitMessage?: string) => {
		setMerging(true);
		try {
			const result = await trpc.cards.commitAndMerge.mutate({ workspaceId, cardId: card.id, commitMessage });
			if (result.status === "needs_commit") {
				showCommitMsgDialog((msg) => doMerge(msg), "merge");
				return;
			}
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
	};

	const doPR = async (commitMessage?: string) => {
		setCreatingPR(true);
		try {
			const result = await trpc.cards.commitAndPR.mutate({ workspaceId, cardId: card.id, commitMessage });
			if (result.status === "needs_commit") {
				showCommitMsgDialog((msg) => doPR(msg), "pr");
				return;
			}
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
	};

	const handleCommitAndMerge = () => {
		ConfirmDialog.show({
			title: `Merge into ${card.baseRef}?`,
			content: "Commits any pending changes and merges the task branch directly. This cannot be undone.",
			confirmButtonLabel: "Merge",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				await doMerge();
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
				await doPR();
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

	const currentBranch = card.branchName ?? `task/${card.id}`;
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
		if (next === (card.branchName ?? "")) { cancelEditBranch(); return; }
		setSavingBranch(true);
		try {
			await trpc.cards.update.mutate({ workspaceId, cardId: card.id, branchName: next || undefined, revision: 0 });
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
					onRefresh();
				}
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const columnStatus = COLUMN_STATUS[card.columnId];
	const priorityBadge = card.priority ? PRIORITY_BADGE[card.priority] : null;
	const agentBadge = agentId ? (AGENT_DISPLAY[agentId] ?? null) : null;
	const externalUrl = card.jiraUrl ?? card.githubIssueUrl ?? card.pr?.url ?? null;

	return (
		<div className="fixed inset-0 z-10 bg-[#0a0a0e] flex flex-col overflow-hidden">

			{/* ── Header ── */}
			<div className="flex items-center gap-3 px-6 py-2.5 border-b border-[#2a2a35] bg-[#141418] shrink-0">
				<button
					onClick={onClose}
					className="text-[#60607a] hover:text-gray-300 transition-colors"
					title="Back to board"
				>
					<ArrowLeft size={18} />
				</button>
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				{projectName && (
					<>
						<span className="text-xs text-[#60607a]">{projectName}</span>
						<span className="text-xs text-[#2a2a35]">/</span>
					</>
				)}
				<span className="text-[13px] font-semibold text-[#f0f0f5] truncate">{card.title}</span>
				<div className="flex-1" />
				{card.jiraKey && (
					<span className="text-[10px] font-mono text-[#4a4a5a]">{card.jiraKey}</span>
				)}
				{externalUrl && (
					<a
						href={externalUrl}
						target="_blank"
						rel="noreferrer"
						className="text-[#60607a] hover:text-gray-300 transition-colors"
						title="Open external link"
					>
						<ExternalLink size={15} />
					</a>
				)}
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				{/* Action buttons */}
				{isStory ? (
					isRunning && (
						<button onClick={handleStop} title="Stop agent" className="text-[#60607a] hover:text-red-400 transition-colors">
							<Square size={15} className="fill-current" />
						</button>
					)
				) : isReadyForReview ? (
					<>
						<Tooltip content={merging ? "Merging..." : `Merge into ${card.baseRef}`} side="bottom" triggerAsChild>
							<button
								onClick={handleCommitAndMerge}
								disabled={merging || creatingPR}
								className="text-[#60607a] hover:text-emerald-400 transition-colors disabled:opacity-40"
							>
								<GitMerge size={15} />
							</button>
						</Tooltip>
						{card.pr?.url ? (
							<a
								href={card.pr.url}
								target="_blank"
								rel="noreferrer"
								title="Open Pull Request"
								className="text-green-400 hover:text-green-300 transition-colors"
							>
								<GitPullRequest size={15} />
							</a>
						) : (
							<Tooltip content={creatingPR ? "Creating..." : `Create PR against ${card.baseRef}`} side="bottom" triggerAsChild>
								<button
									onClick={handleCommitAndPR}
									disabled={merging || creatingPR}
									className="text-[#60607a] hover:text-green-400 transition-colors disabled:opacity-40"
								>
									<GitPullRequest size={15} />
								</button>
							</Tooltip>
						)}
					</>
				) : isRunning ? (
					<button onClick={handleStop} title="Stop agent" className="text-[#60607a] hover:text-red-400 transition-colors">
						<Square size={15} className="fill-current" />
					</button>
				) : (
					<button onClick={handleStart} title="Start agent" className="text-[#60607a] hover:text-emerald-400 transition-colors">
						<Play size={15} />
					</button>
				)}
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				<button
					onClick={handleDelete}
					className="text-[#60607a] hover:text-red-400 transition-colors"
					title="Delete task"
				>
					<Trash2 size={15} />
				</button>
			</div>

			{/* ── Sub-header ── */}
			<div className="flex items-center gap-2 px-6 py-2 border-b border-[#2a2a35] bg-[#141418] shrink-0 flex-wrap">
				{columnStatus && (
					<span className={`flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border ${columnStatus.color} ${columnStatus.bg} ${columnStatus.border}`}>
						<span
							className={`size-[7px] rounded-full shrink-0 ${columnStatus.dotColor}`}
							style={columnStatus.glow ? { boxShadow: `0 0 5px ${columnStatus.glow}` } : {}}
						/>
						{columnStatus.label}
					</span>
				)}
				{priorityBadge && (
					<span className={`flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border ${priorityBadge.color} ${priorityBadge.bg} ${priorityBadge.border}`}>
						<span className={`size-[7px] rounded-full shrink-0 ${priorityBadge.dotColor}`} />
						{card.priority!.charAt(0).toUpperCase() + card.priority!.slice(1)}
					</span>
				)}
				{agentBadge && (
					<span className={`flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] font-medium border ${agentBadge.color} ${agentBadge.bg} ${agentBadge.border}`}>
						<span className={`size-[7px] rounded-full shrink-0 ${agentBadge.dotColor}`} />
						{agentBadge.label}
					</span>
				)}
				{card.branchName && (
					<span className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35]">
						<GitBranch size={11} />
						{card.branchName}
					</span>
				)}
				{card.worktreePath && (
					<button
						onClick={() => trpc.fs.openTerminal.mutate({ path: card.worktreePath! })}
						className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35] hover:border-[#3a3a48] transition-colors"
					>
						<FolderOpen size={11} />
						{card.worktreePath.split("/").slice(-2).join("/")}
					</button>
				)}
				<div className="flex-1" />
				{isRunning && (
					<span className="flex items-center gap-1.5 text-[11px] font-medium text-[#f0f0f5]">
						<Clock size={13} className="text-[#60607a]" />
						<span className="font-mono">{formatElapsed(elapsedSec)}</span>
					</span>
				)}
			</div>

			{/* ── Main content ── */}
			<div className="flex flex-1 min-h-0 overflow-hidden">

				{/* Terminal / left panel */}
				<div className="flex-1 min-w-0 flex flex-col bg-[#141418]">
					{/* Tab bar */}
					<div className="flex shrink-0 bg-[#0d0d12] border-b border-[#2a2a35] px-5">
						{([
							{ id: "terminal" as RightTab, label: "Terminal", Icon: TerminalSquare },
							...(!isStory ? [{ id: "diff" as RightTab, label: "Diff", Icon: GitBranch }] : []),
							{ id: "comments" as RightTab, label: `Comments${commentCount > 0 ? ` (${commentCount})` : ""}`, Icon: null },
						] as { id: RightTab; label: string; Icon: React.FC<{ size: number }> | null }[]).map(({ id, label, Icon }) => (
							<button
								key={id}
								onClick={() => setRightTab(id)}
								className={`relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors ${
									rightTab === id ? "text-[#f0f0f5]" : "text-[#4a4a5a] hover:text-[#8888a0]"
								}`}
							>
								{Icon && <Icon size={11} />}
								{label}
								{rightTab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7c6aff]" />}
							</button>
						))}
					</div>

					{rightTab === "terminal" &&
						(hasTerminalOutput ? (
							<TaskTerminal key={activeStreamId} taskId={activeStreamId} workspaceId={workspaceId} className="flex-1" />
						) : (
							<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-600">
								<span className="text-4xl">⌨</span>
								<p className="text-sm">No agent output yet</p>
								<p className="text-xs">Start the agent to see terminal output here</p>
							</div>
						))}
					{rightTab === "diff" && (
						<DiffView workspaceId={workspaceId} cardId={card.id} isReadyForReview={isReadyForReview} onRefresh={onRefresh} />
					)}
					{rightTab === "comments" && (
						<ChatComments card={card} workspaceId={workspaceId} allCards={allCards} workflowSlots={workflowSlots} onRefresh={onRefresh} />
					)}
				</div>

				{/* ── Right sidebar ── */}
				<div className="w-80 shrink-0 bg-[#141418] border-l border-[#2a2a35] flex flex-col overflow-hidden">

					{/* Workflow Pipeline */}
					<div className="shrink-0">
						<div className="px-[18px] pt-3.5 pb-2">
							<span className="text-[11px] font-semibold text-[#8888a0] tracking-[0.3px]">Workflow Pipeline</span>
						</div>
						<div className="flex flex-col px-[18px] pb-4">
							{workflowSlots && workflowSlots.length > 0 ? (() => {
								const activeSlots = workflowSlots.filter(slot => visibleSessions.some(ts => ts.type === slot.id));
								return activeSlots.map((slot, idx) => {
								// Use the most recent session for this slot (in case of retries)
								// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
								const session = visibleSessions.filter((ts) => ts.type === slot.id).at(-1)!;
								const status = !session.endedAt
									? "running"
									: session.state === "failed" || session.state === "stopped"
										? session.state
										: "completed";
								const duration = slotDuration(session.startedAt, session.endedAt);
								const isFocused = activeStreamId === session.streamId;
								return (
									<div key={slot.id} className="flex items-stretch gap-0">
										{/* Focus indicator */}
										<div className={`w-0.5 shrink-0 rounded-full mr-2 self-stretch transition-colors ${isFocused ? "bg-[#7c6aff]" : "bg-transparent"}`} />
										{/* Status icon + connector */}
										<div className="flex flex-col items-center w-7 shrink-0">
											<div className={`size-6 rounded-full flex items-center justify-center shrink-0 ${status === "running" ? "bg-[#3b82f6]/15" : "bg-transparent"}`}>
												{status === "completed" && <CheckCircle2 size={14} className="text-[#22c55e]" />}
												{status === "running" && (
													<Play
														size={14}
														className="text-[#3b82f6] fill-current"
														style={{ filter: "drop-shadow(0 0 6px #3b82f650)" }}
													/>
												)}
												{status === "failed" && <Circle size={14} className="text-[#ef4444]" />}
												{status === "stopped" && <Circle size={14} className="text-yellow-400" />}
											</div>
											{idx < activeSlots.length - 1 && (
												<div className={`w-0.5 flex-1 min-h-[12px] rounded-full mt-0.5 mb-0.5 ${status === "completed" ? "bg-[#22c55e]/40" : "bg-[#2a2a35]"}`} />
											)}
										</div>
										{/* Info */}
										<button
											onClick={() => {
												setActiveStreamId(session.streamId);
												setRightTab("terminal");
											}}
											className={`flex flex-col gap-0.5 pl-2 py-0.5 pb-3 flex-1 min-w-0 text-left cursor-pointer rounded transition-colors ${isFocused ? "bg-[#7c6aff]/8" : "hover:bg-white/[0.03]"}`}
										>
											<span className={`text-xs ${isFocused ? "font-semibold text-[#c4baff]" : status === "running" ? "font-semibold text-[#f0f0f5]" : status === "completed" ? "text-[#f0f0f5]" : "text-[#4a4a5a]"}`}>
												{slot.name}
											</span>
											<span className="text-[10px] flex items-center gap-1.5">
												{status === "running" && <span className={isFocused ? "text-[#a78bfa]" : "text-[#3b82f6]"}>Running</span>}
												{status === "completed" && <span className="text-[#22c55e]">Completed</span>}
												{status !== "running" && status !== "completed" && <span className="text-[#4a4a5a]">—</span>}
												{duration && (
													<>
														<span className="text-[#4a4a5a]">·</span>
														<span className="text-[#4a4a5a] font-mono">{duration}</span>
													</>
												)}
											</span>
										</button>
									</div>
								);
								});
							})() : (
								<p className="text-xs text-[#4a4a5a] pb-2">No workflow configured</p>
							)}
						</div>
					</div>

					<div className="h-px bg-[#2a2a35] shrink-0" />

					{/* Details */}
					<div className="px-[18px] pt-3.5 pb-2 shrink-0">
						<span className="text-[11px] font-semibold text-[#8888a0] tracking-[0.3px]">Details</span>
					</div>
					<div className="flex-1 min-h-0 overflow-y-auto px-[18px] pb-4 flex flex-col gap-3">
						{/* Description */}
						{card.description && (
							<div>
								<p className={`text-xs text-[#8888a0] whitespace-pre-wrap leading-relaxed ${descExpanded ? "" : "line-clamp-4"}`}>
									{card.description}
								</p>
								{(card.description.split("\n").length > 4 || card.description.length > 240) && (
									<button
										onClick={() => setDescExpanded((v) => !v)}
										className="mt-1 text-[11px] text-[#4a4a5a] hover:text-[#8888a0] transition-colors"
									>
										{descExpanded ? "Show less" : "Show more"}
									</button>
								)}
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
								onChange={(e) => {
									if (e.target.files) void handleDescriptionAttach(e.target.files);
									e.target.value = "";
								}}
							/>
							{(card.descriptionAttachments?.length ?? 0) > 0 &&
								(() => {
									const isImg = (att: { mimeType?: string; name: string }) =>
										(att.mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
									const indexed = (card.descriptionAttachments ?? []).map((att, idx) => ({ att, idx }));
									const imgs = indexed.filter(({ att }) => isImg(att));
									const files = indexed.filter(({ att }) => !isImg(att));
									const RemoveBtn = ({ idx }: { idx: number }) => (
										<button
											onClick={() => void handleRemoveDescAttachment(idx)}
											className="absolute -top-1 -right-1 size-4 rounded-full bg-[#1a1a1f] border border-[#2a2a35] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
								className="flex items-center gap-1.5 text-xs text-[#4a4a5a] hover:text-[#8888a0] transition-colors disabled:opacity-50"
							>
								<Paperclip size={12} />
								{uploadingDesc ? "Uploading…" : "Attach file"}
							</button>
						</div>

						{/* Branch */}
						{card.baseRef && (
							<div className="flex items-start gap-2 text-xs text-[#8888a0]">
								<GitBranch size={11} className="shrink-0 mt-0.5" />
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
											placeholder={`task/${card.id}`}
											disabled={savingBranch}
										/>
										<button
											onClick={() => void saveBranchName()}
											disabled={savingBranch}
											className="p-1 rounded text-[#4a4a5a] hover:text-[#22c55e] hover:bg-[#1a1a1f] transition-colors disabled:opacity-50"
										>
											<Check size={12} />
										</button>
										<button
											onClick={cancelEditBranch}
											disabled={savingBranch}
											className="p-1 rounded text-[#4a4a5a] hover:text-[#8888a0] hover:bg-[#1a1a1f] transition-colors disabled:opacity-50"
										>
											<X size={12} />
										</button>
									</div>
								) : (
									<div className="flex items-center gap-1 flex-wrap">
										<span className="font-mono text-[#8888a0] truncate max-w-[110px]" title={currentBranch}>{currentBranch}</span>
										{canEditBranch && (
											<button
												onClick={startEditBranch}
												className="p-0.5 rounded text-[#4a4a5a] hover:text-[#8888a0] hover:bg-[#1a1a1f] transition-colors"
											>
												<Pencil size={10} />
											</button>
										)}
										<span className="text-[#4a4a5a]">→</span>
										<span className="font-mono text-[#8888a0] truncate max-w-[110px]">{card.baseRef}</span>
									</div>
								)}
							</div>
						)}

						{/* Dependencies */}
						{(card.dependsOn ?? []).length > 0 && (
							<div>
								<p className="text-[10px] font-medium text-[#4a4a5a] mb-1.5">Dependencies</p>
								<div className="space-y-1">
									{(card.dependsOn ?? []).map((depId) => {
										const dep = allCards?.[depId];
										if (!dep) return null;
										return (
											<div
												key={depId}
												className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#1a1a1f] border border-[#2a2a35]"
											>
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

						{/* External links */}
						{(card.githubIssueUrl || card.pr?.url || card.jiraUrl) && (
							<div className="space-y-1">
								{card.githubIssueUrl && (
									<a href={card.githubIssueUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
										<ExternalLink size={11} /> GitHub Issue
									</a>
								)}
								{card.pr?.url && (
									<a href={card.pr?.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-green-400 hover:text-green-300">
										<ExternalLink size={11} /> Pull Request
									</a>
								)}
								{card.jiraUrl && (
									<a href={card.jiraUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300">
										<ExternalLink size={11} /> {card.jiraKey}
									</a>
								)}
							</div>
						)}
					</div>

					<div className="h-px bg-[#2a2a35] shrink-0" />

					{/* Activity */}
					<div className="shrink-0">
						<button
							onClick={() => setActivityExpanded((v) => !v)}
							className="flex items-center w-full gap-1.5 px-[18px] py-3.5"
						>
							<span className="text-[11px] font-semibold text-[#8888a0] tracking-[0.3px] flex-1 text-left">Activity</span>
							<ChevronRight size={14} className={`text-[#4a4a5a] transition-transform duration-150 ${activityExpanded ? "rotate-90" : ""}`} />
						</button>
						{activityExpanded && (
							<div className="px-[18px] pb-3 max-h-48 overflow-y-auto">
								{!card.activityLog?.length ? (
									<p className="text-xs text-[#4a4a5a] py-2">No activity yet</p>
								) : (
									<div className="space-y-1.5">
										{card.activityLog.map((entry, i) => (
											<div key={i} className="flex items-baseline gap-2 text-xs">
												<span className="text-[#4a4a5a] shrink-0 tabular-nums">
													{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
												</span>
												<span className="text-[#8888a0]">{entry.message}</span>
											</div>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			{/* attempt count hint in bottom bar only when retries exist */}
			{card.autoFixAttempts > 0 && (
				<div className="flex items-center gap-2.5 px-6 py-2 border-t border-[#2a2a35] bg-[#141418] shrink-0">
					<span className="text-[10px] text-[#4a4a5a]">Attempt {card.autoFixAttempts + 1}</span>
				</div>
			)}
		</div>
	);
}
