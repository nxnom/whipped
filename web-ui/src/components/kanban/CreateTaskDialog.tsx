import { Input, Select, SelectOption, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import {
	GitBranch, GripVertical, ListTree, Monitor, Paperclip,
	Plus, Sparkles, Workflow as WorkflowIcon, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { deriveBranchName } from "@/utils/branch";
import type { SubtaskDraft } from "./CreateStoryDrawer";

interface PendingImage {
	dataUrl: string | null;
	file: File;
}

async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
	const { uploadAttachmentFile } = await import("@/runtime/attachments");
	const results = [];
	for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
	return results;
}

function addFilesFromClipboard(
	e: { clipboardData: DataTransfer; preventDefault(): void },
	setter: (fn: (prev: PendingImage[]) => PendingImage[]) => void,
) {
	const files = Array.from(e.clipboardData.files);
	if (!files.length) return;
	e.preventDefault();
	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const r = new FileReader();
			r.onload = (ev) => setter((p) => [...p, { dataUrl: ev.target?.result as string, file }]);
			r.readAsDataURL(file);
		} else {
			setter((p) => [...p, { dataUrl: null, file }]);
		}
	}
}

function ImagePicker({ pending, onChange }: { pending: PendingImage[]; onChange: (imgs: PendingImage[]) => void }) {
	const ref = useRef<HTMLInputElement>(null);
	const addFiles = (files: FileList | File[]) => {
		Array.from(files).forEach((file) => {
			if (file.type.startsWith("image/")) {
				const r = new FileReader();
				r.onload = (ev) => onChange([...pending, { dataUrl: ev.target?.result as string, file }]);
				r.readAsDataURL(file);
			} else {
				onChange([...pending, { dataUrl: null, file }]);
			}
		});
	};
	if (pending.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 mt-2 shrink-0">
			<input ref={ref} type="file" accept="*/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
			{pending.map((img, i) => (
				<div key={i} className="relative group">
					{img.dataUrl ? (
						<img src={img.dataUrl} alt={img.file.name} className="h-12 w-12 object-cover rounded border border-[#2a2a35]" />
					) : (
						<div className="h-12 w-12 flex flex-col items-center justify-center rounded border border-[#2a2a35] bg-[#1a1a1f] gap-1">
							<Paperclip size={12} className="text-[#60607a]" />
							<span className="text-[9px] text-[#60607a] truncate w-10 text-center px-1">{img.file.name}</span>
						</div>
					)}
					<button
						type="button"
						onClick={() => onChange(pending.filter((_, j) => j !== i))}
						className="absolute -top-1 -right-1 size-4 rounded-full bg-[#1a1a1f] border border-[#2a2a35] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<X size={9} className="text-[#f0f0f5]" />
					</button>
				</div>
			))}
		</div>
	);
}

const PRIORITY_OPTIONS = [
	{ value: "urgent", label: "Urgent", dot: "#ef4444", bg: "#ef444415", text: "#ef4444", border: "#ef444440" },
	{ value: "high",   label: "High",   dot: "#f97316", bg: "#f9731615", text: "#f97316", border: "#f9731640" },
	{ value: "medium", label: "Medium", dot: "#eab308", bg: "#eab30815", text: "#eab308", border: "#eab30840" },
	{ value: "low",    label: "Low",    dot: "#6b7280",  bg: "#6b728015", text: "#6b7280",  border: "#6b728040" },
] as const;

const COLUMN_BADGE: Record<string, string> = {
	todo: "text-gray-400 bg-gray-700",
	in_progress: "text-blue-400 bg-blue-400/10",
	reopened: "text-orange-400 bg-orange-400/10",
	ready_for_review: "text-green-400 bg-green-400/10",
	blocked: "text-red-400 bg-red-400/10",
	done: "text-emerald-400 bg-emerald-400/10",
};

const COLUMN_LABEL: Record<string, string> = {
	todo: "Todo",
	in_progress: "In Progress",
	reopened: "Reopened",
	ready_for_review: "Ready for Review",
	blocked: "Blocked",
	done: "Done",
};

type Mode = "task" | "story";

// ─── Subtask creation dialog ─────────────────────────────────────────────────

interface CreateSubtaskDialogProps {
	open: boolean;
	onClose: () => void;
	onSave: (subtask: SubtaskDraft) => void;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	draftSubtasks: SubtaskDraft[];
	editingSubtask?: SubtaskDraft;
	defaultBranch: string;
	branches: string[];
}

function CreateSubtaskDialog({
	open,
	onClose,
	onSave,
	allCards,
	workflows,
	draftSubtasks,
	editingSubtask,
	defaultBranch,
	branches,
}: CreateSubtaskDialogProps) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const defaultWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];

	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [priority, setPriority] = useState("");
	const [baseRef, setBaseRef] = useState(defaultBranch);
	const [workflowId, setWorkflowId] = useState(defaultWorkflow?.id ?? "");
	const [branchName, setBranchName] = useState("");
	const [branchNameEdited, setBranchNameEdited] = useState(false);
	const [dependsOn, setDependsOn] = useState<string[]>([]);

	useEffect(() => {
		if (!open) return;
		if (editingSubtask) {
			setTitle(editingSubtask.title);
			setDescription(editingSubtask.description);
			setPendingImages(editingSubtask.pendingImages);
			setPriority(editingSubtask.priority);
			setBaseRef(editingSubtask.baseRef || defaultBranch);
			setWorkflowId(editingSubtask.workflowId || (defaultWorkflow?.id ?? ""));
			setDependsOn(editingSubtask.dependsOn);
			setBranchName(editingSubtask.branchName || "");
			setBranchNameEdited(!!editingSubtask.branchName);
		} else {
			setTitle("");
			setDescription("");
			setPendingImages([]);
			setPriority("");
			setBaseRef(defaultBranch);
			setWorkflowId(defaultWorkflow?.id ?? "");
			setDependsOn([]);
			setBranchName("");
			setBranchNameEdited(false);
		}
	}, [open, editingSubtask]);

	const handleSave = () => {
		if (!title.trim()) return;
		onSave({
			tempId: editingSubtask?.tempId ?? `draft-${Date.now()}-${Math.random()}`,
			title: title.trim(),
			description,
			pendingImages,
			priority,
			baseRef,
			workflowId,
			branchName,
			dependsOn,
		});
	};

	const isEditing = !!editingSubtask;
	const otherDrafts = draftSubtasks.filter((s) => s.tempId !== editingSubtask?.tempId);
	const boardCardPool = Object.values(allCards).filter((c) => c.columnId !== "done" && (c as any).type !== "story");

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center">
			<div className="absolute inset-0 bg-black/50" onClick={onClose} />
			<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">

				{/* ── Left panel ── */}
				<div className="flex flex-col flex-1 overflow-hidden" onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}>
					<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
						<span className="text-[15px] font-semibold text-[#f0f0f5]">{isEditing ? "Edit Subtask" : "New Subtask"}</span>
						<div className="flex-1" />
						<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
							<X size={18} />
						</button>
					</div>

					<div className="px-8 pt-6 shrink-0">
						<input
							autoFocus
							value={title}
							onChange={(e) => {
								const v = e.target.value;
								setTitle(v);
								if (!branchNameEdited) setBranchName(deriveBranchName(v));
							}}
							onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSave(); }}
							placeholder="Subtask title"
							className="w-full bg-transparent text-[28px] font-semibold text-[#f0f0f5] placeholder-[#2a2a35] outline-none"
						/>
					</div>

					<div className="flex flex-col flex-1 min-h-0 px-8 py-4 gap-2" onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Describe what the agent should do..."
							className="flex-1 min-h-0 bg-transparent text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7]"
						/>
						<ImagePicker pending={pendingImages} onChange={setPendingImages} />
						<div className="flex items-center gap-2 shrink-0 mt-auto pt-1">
							<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
								<Paperclip size={12} />
								Attach files
							</button>
							<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
								<Monitor size={12} />
								Screenshot
							</button>
						</div>
					</div>
				</div>

				{/* ── Right sidebar ── */}
				<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
					<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
						<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
					</div>

					<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Workflow</span>
							<Select value={workflowId} onChange={(v) => setWorkflowId(v as string)} prefix={<WorkflowIcon size={14} className="text-[#8888a0]" />}>
								{taskWorkflows.map((w) => (
									<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
								))}
							</Select>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
							<div className="flex flex-wrap gap-1.5">
								{PRIORITY_OPTIONS.map((opt) => {
									const active = priority === opt.value;
									return (
										<button
											key={opt.value}
											onClick={() => setPriority(active ? "" : opt.value)}
											className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition-colors"
											style={active
												? { background: opt.bg, color: opt.text, borderColor: opt.border, fontWeight: 500 }
												: { background: "#1a1a1f", color: "#60607a", borderColor: "#2a2a35" }}
										>
											<span className="size-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />
											{opt.label}
										</button>
									);
								})}
							</div>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Branch Name (optional)</span>
							<Input
								value={branchName}
								onChange={(e) => { setBranchName(e.target.value); setBranchNameEdited(true); }}
								placeholder="auto-generated from title"
								prefix={<GitBranch size={13} className="text-[#4a4a5a]" />}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Base Branch</span>
							<Select value={baseRef} onChange={(v) => setBaseRef(v as string)} placeholder="main" filterable prefix={<GitBranch size={13} className="text-[#8888a0]" />}>
								{branches.map((b) => <SelectOption key={b} value={b} label={b} />)}
							</Select>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
							<Select multiple value={dependsOn} onChange={(v) => setDependsOn(v)} placeholder="None" filterable clearable>
								{otherDrafts.map((draft) => (
									<SelectOption key={draft.tempId} value={draft.tempId} label={draft.title} hideCheckIcon>
										<div className="flex items-center justify-between w-full gap-2 min-w-0">
											<span className="truncate text-sm">{draft.title}</span>
											<span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium text-[#a78bfa] bg-[#a78bfa10]">this story</span>
										</div>
									</SelectOption>
								))}
								{boardCardPool.map((c) => (
									<SelectOption key={c.id} value={c.id} label={c.title} hideCheckIcon>
										<div className="flex items-center justify-between w-full gap-2 min-w-0">
											<span className="truncate text-sm">{c.title}</span>
											<span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700"}`}>
												{COLUMN_LABEL[c.columnId] ?? c.columnId}
											</span>
										</div>
									</SelectOption>
								))}
							</Select>
						</div>
					</div>

					<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
						<div className="flex-1" />
						<button
							onClick={handleSave}
							disabled={!title.trim()}
							className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white bg-[#7c6aff] disabled:opacity-40 disabled:cursor-not-allowed"
						>
							<Plus size={14} />
							{isEditing ? "Save Changes" : "Add Subtask"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

interface CreateTaskDialogProps {
	open: boolean;
	onClose: () => void;
	initialMode?: Mode;
	workspaceId: string;
	allCards: Record<string, RuntimeBoardCard>;
	workflows: Workflow[];
	onRefresh: () => void;
	navigate: (path: string) => void;
}

export function CreateTaskDialog({
	open,
	onClose,
	initialMode = "task",
	workspaceId,
	allCards,
	workflows,
	onRefresh,
	navigate,
}: CreateTaskDialogProps) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);
	const defaultTaskWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];
	const defaultStoryWorkflow = storyWorkflows.find((w) => w.isDefault) ?? storyWorkflows[0];

	const [mode, setMode] = useState<Mode>(initialMode);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
	const [priority, setPriority] = useState("");
	const [baseRef, setBaseRef] = useState("");
	const [branches, setBranches] = useState<string[]>([]);
	const [readyForDev, setReadyForDev] = useState(true);
	const [loading, setLoading] = useState(false);

	// Task-only
	const [workflowId, setWorkflowId] = useState(defaultTaskWorkflow?.id ?? "");
	const [branchName, setBranchName] = useState("");
	const [branchNameEdited, setBranchNameEdited] = useState(false);
	const [dependsOn, setDependsOn] = useState<string[]>([]);

	// Story-only
	const [storyWorkflowId, setStoryWorkflowId] = useState(defaultStoryWorkflow?.id ?? "");
	const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
	const [subtaskDialogOpen, setSubtaskDialogOpen] = useState(false);
	const [editingTempId, setEditingTempId] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			trpc.cards.listBranches
				.query({ workspaceId })
				.then(({ branches: b, defaultBranch }) => {
					setBranches(b);
					setBaseRef(defaultBranch);
				})
				.catch(() => {});
		}
	}, [open, workspaceId]);

	useEffect(() => {
		if (open) setMode(initialMode);
	}, [open, initialMode]);

	const handleClose = () => {
		setTitle("");
		setDescription("");
		setPendingImages([]);
		setPriority("");
		setBranchName("");
		setBranchNameEdited(false);
		setDependsOn([]);
		setSubtasks([]);
		setEditingTempId(null);
		setSubtaskDialogOpen(false);
		setReadyForDev(true);
		setWorkflowId(defaultTaskWorkflow?.id ?? "");
		setStoryWorkflowId(defaultStoryWorkflow?.id ?? "");
		onClose();
	};

	const handleCreateTask = async () => {
		if (!title.trim()) return;
		setLoading(true);
		try {
			// Inherit shared worktree from the single dep if present
			let sharedWorktreeId: string | undefined;
			if (dependsOn.length === 1) {
				const dep = allCards[dependsOn[0]!];
				if (dep) sharedWorktreeId = dep.sharedWorktreeId ?? dep.id;
			}
			const card = await trpc.cards.create.mutate({
				workspaceId,
				title: title.trim(),
				description,
				priority: (priority as "urgent" | "high" | "medium" | "low") || undefined,
				readyForDev: readyForDev || undefined,
				dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
				baseRef: baseRef || undefined,
				workflowId: workflowId || undefined,
				branchName: branchName.trim() || undefined,
				sharedWorktreeId,
			});
			if (pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, card.id, pendingImages);
				await trpc.cards.update.mutate({ workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 });
			}
			handleClose();
			onRefresh();
		} catch {
			toast.error("Failed to create task");
		} finally {
			setLoading(false);
		}
	};

	const handleCreateStory = async () => {
		if (!title.trim() || subtasks.length === 0) return;
		setLoading(true);
		console.log("[CreateStory] Starting story creation");
		console.log("[CreateStory] Story title:", title.trim());
		console.log("[CreateStory] Story description:", description);
		console.log("[CreateStory] Story priority:", priority);
		console.log("[CreateStory] Base ref:", baseRef);
		console.log("[CreateStory] Story workflow ID:", storyWorkflowId);
		console.log("[CreateStory] Ready for dev:", readyForDev);
		console.log("[CreateStory] Subtasks:", JSON.parse(JSON.stringify(subtasks)));
		try {
			const tempIdToRealId = new Map<string, string>();
			const created: Array<{ realId: string; rawDeps: string[] }> = [];
			for (const subtask of subtasks) {
				const existingDeps = subtask.dependsOn.filter((dep) => !subtasks.some((s) => s.tempId === dep));
				console.log(`[CreateStory] Creating subtask "${subtask.title}"`, { workflowId: subtask.workflowId, baseRef: subtask.baseRef || baseRef, branchName: subtask.branchName, priority: subtask.priority, existingDeps });
				const card = await trpc.cards.create.mutate({
					workspaceId,
					title: subtask.title.trim(),
					description: subtask.description,
					type: "subtask",
					priority: (subtask.priority as "urgent" | "high" | "medium" | "low") || undefined,
					baseRef: subtask.baseRef || baseRef || undefined,
					workflowId: subtask.workflowId || undefined,
					branchName: subtask.branchName.trim() || undefined,
					dependsOn: existingDeps.length > 0 ? existingDeps : undefined,
					readyForDev: readyForDev,
				});
				if (subtask.pendingImages.length > 0) {
					const uploaded = await uploadImages(workspaceId, card.id, subtask.pendingImages);
					await trpc.cards.update.mutate({ workspaceId, cardId: card.id, descriptionAttachments: uploaded, revision: 0 });
				}
				console.log(`[CreateStory] Subtask "${subtask.title}" created with id: ${card.id}`);
				tempIdToRealId.set(subtask.tempId, card.id);
				created.push({ realId: card.id, rawDeps: subtask.dependsOn });
			}
			for (const { realId, rawDeps } of created) {
				const batchDeps = rawDeps.filter((dep) => tempIdToRealId.has(dep));
				if (batchDeps.length === 0) continue;
				const resolvedBatchDeps = batchDeps.map((dep) => tempIdToRealId.get(dep)!);
				const existingDeps = rawDeps.filter((dep) => !tempIdToRealId.has(dep));
				await trpc.cards.update.mutate({
					workspaceId,
					cardId: realId,
					dependsOn: [...existingDeps, ...resolvedBatchDeps],
					revision: 0,
				});
			}
			console.log("[CreateStory] All subtasks created. tempId→realId map:", Object.fromEntries(tempIdToRealId));
			console.log("[CreateStory] Creating story card with subtask deps:", created.map((c) => c.realId));
			const storyCard = await trpc.cards.create.mutate({
				workspaceId,
				title: title.trim(),
				description,
				type: "story",
				priority: (priority as "urgent" | "high" | "medium" | "low") || undefined,
				baseRef: baseRef || undefined,
				workflowId: storyWorkflowId || undefined,
				dependsOn: created.map((c) => c.realId),
			});
			if (pendingImages.length > 0) {
				const uploaded = await uploadImages(workspaceId, storyCard.id, pendingImages);
				await trpc.cards.update.mutate({ workspaceId, cardId: storyCard.id, descriptionAttachments: uploaded, revision: 0 });
			}
			// Pass 3: wire sharedWorktreeId on all subtasks so they share the story's worktree
			for (const { realId } of created) {
				await trpc.cards.update.mutate({ workspaceId, cardId: realId, sharedWorktreeId: storyCard.id, revision: 0 });
			}
			console.log("[CreateStory] Story card created with id:", storyCard.id);
			handleClose();
			onRefresh();
		} catch (err) {
			console.error("[CreateStory] Error:", err);
			toast.error("Failed to create story");
		} finally {
			setLoading(false);
		}
	};

	const isTask = mode === "task";
	const accentColor = isTask ? "#7c6aff" : "#a78bfa";
	const editingSubtask = editingTempId ? subtasks.find((s) => s.tempId === editingTempId) : undefined;
	const activeWorkflows = isTask ? taskWorkflows : storyWorkflows;
	const activeWorkflowId = isTask ? workflowId : storyWorkflowId;
	const setActiveWorkflowId = isTask ? setWorkflowId : setStoryWorkflowId;

	if (!open) return null;

	return (
		<>
			<div className="fixed inset-0 z-50 flex items-center justify-center">
				{/* Backdrop */}
				<div className="absolute inset-0 bg-black/70" onClick={handleClose} />

				{/* Dialog */}
				<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">

					{/* ── Left panel ── */}
					<div className="flex flex-col flex-1 overflow-hidden" onPaste={(e) => addFilesFromClipboard(e, setPendingImages)}>

						{/* Header */}
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">{isTask ? "New Task" : "New Story"}</span>
							<div className="flex-1" />
							<button onClick={handleClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
								<X size={18} />
							</button>
						</div>

						{/* Title */}
						<div className="px-8 pt-6 shrink-0">
							<input
								autoFocus
								value={title}
								onChange={(e) => {
									const v = e.target.value;
									setTitle(v);
									if (isTask && !branchNameEdited) setBranchName(deriveBranchName(v));
								}}
								onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && isTask) handleCreateTask(); }}
								placeholder={isTask ? "Task title" : "Story title"}
								className="w-full bg-transparent text-[28px] font-semibold text-[#f0f0f5] placeholder-[#2a2a35] outline-none"
							/>
						</div>

						{/* Editor area */}
						<div className="flex flex-col flex-1 min-h-0 px-8 py-4 gap-2">

							{/* Story: objective label */}
							{!isTask && (
								<div className="flex items-center gap-1.5 shrink-0">
									<span className="text-[11px] font-medium text-[#60607a]">Story Objective</span>
									<div className="flex-1" />
									<span className="text-[10px] text-[#4a4a5a]">The orchestrator will break this into subtasks</span>
								</div>
							)}

							{/* Description */}
							<textarea
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Describe what the agent should do..."
								className={`bg-transparent text-[15px] text-[#c0c0d0] placeholder-[#2a2a35] outline-none resize-none leading-[1.7] shrink-0 ${isTask ? "flex-1 min-h-0" : "h-36"}`}
							/>

							<ImagePicker pending={pendingImages} onChange={setPendingImages} />

							{/* Story: subtasks */}
							{!isTask && (
								<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
									<div className="h-px bg-[#2a2a35] shrink-0 my-2" />
									{/* Subtasks header */}
									<div className="flex items-center gap-2 shrink-0 mb-2">
										<ListTree size={14} className="text-[#8888a0]" />
										<span className="text-xs font-semibold text-[#8888a0]">Subtasks</span>
										{subtasks.length > 0 && (
											<div className="bg-[#2a2a35] rounded-full px-1.5 py-0.5">
												<span className="text-[10px] text-[#60607a]">{subtasks.length}</span>
											</div>
										)}
										<div className="flex-1" />
										<button className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#7c6aff15] border border-[#7c6aff30] text-[11px] font-medium text-[#7c6aff]">
											<Sparkles size={12} />
											Generate
										</button>
										<button
											onClick={() => { setEditingTempId(null); setSubtaskDialogOpen(true); }}
											className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors"
										>
											<Plus size={12} />
											Add
										</button>
									</div>
									{/* Subtask list */}
									<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
										{subtasks.length === 0 && (
											<div
												onClick={() => { setEditingTempId(null); setSubtaskDialogOpen(true); }}
												className="border border-dashed border-[#2a2a35] rounded-lg p-5 flex flex-col items-center gap-2 cursor-pointer hover:border-[#3a3a48] hover:bg-white/[0.02] transition-colors"
											>
												<Plus size={16} className="text-[#4a4a5a]" />
												<p className="text-xs text-[#4a4a5a]">At least one subtask is required</p>
											</div>
										)}
										{subtasks.map((subtask, i) => {
											const depLabels = subtask.dependsOn.map((dep) => {
												const draft = subtasks.find((s) => s.tempId === dep);
												return draft ? `#${subtasks.indexOf(draft) + 1}` : (allCards[dep]?.title ?? dep);
											});
											const priorityOpt = PRIORITY_OPTIONS.find((p) => p.value === subtask.priority);
											return (
												<button
													key={subtask.tempId}
													onClick={() => { setEditingTempId(subtask.tempId); setSubtaskDialogOpen(true); }}
													className="flex items-center gap-2.5 bg-[#1a1a1f] border border-[#2a2a35] rounded-md px-2.5 py-2 text-left hover:border-[#3a3a48] transition-colors group w-full"
												>
													<GripVertical size={12} className="text-[#2a2a35] shrink-0" />
													<span className="text-[10px] text-[#4a4a5a] font-mono shrink-0 w-4">{i + 1}</span>
													<span className="flex-1 min-w-0 text-xs text-[#f0f0f5] truncate">{subtask.title}</span>
													{priorityOpt && (
														<span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: priorityOpt.text, background: priorityOpt.bg }}>
															{priorityOpt.label}
														</span>
													)}
													{depLabels.length > 0 && (
														<span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full text-[#3b82f6] bg-[#3b82f610] border border-[#3b82f620]">
															after {depLabels.join(" ")}
														</span>
													)}
													<span
														onClick={(e) => { e.stopPropagation(); setSubtasks((prev) => prev.filter((s) => s.tempId !== subtask.tempId)); }}
														className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#4a4a5a] hover:text-[#ef4444] p-0.5"
													>
														<X size={12} />
													</span>
												</button>
											);
										})}
									</div>
								</div>
							)}

							{/* Bottom attach buttons */}
							<div className="flex items-center gap-2 shrink-0 mt-auto pt-1">
								<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
									<Paperclip size={12} />
									Attach files
								</button>
								{isTask && (
									<button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a35] text-[11px] text-[#60607a] hover:text-[#f0f0f5] hover:border-[#3a3a48] transition-colors">
										<Monitor size={12} />
										Screenshot
									</button>
								)}
							</div>
						</div>
					</div>

					{/* ── Right sidebar ── */}
					<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">

						{/* Config header */}
						<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
							<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
						</div>

						{/* Config fields */}
						<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">

							{/* Workflow */}
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">{isTask ? "Workflow" : "Orchestrator Workflow"}</span>
								{activeWorkflows.length === 0 ? (
									<button
										className="text-[11px] text-amber-500 hover:text-amber-400 underline text-left transition-colors"
										onClick={() => { handleClose(); navigate(`/${encodeURIComponent(workspaceId)}/settings/workflows`); }}
									>
										No workflows — create one in Settings
									</button>
								) : (
									<Select
										value={activeWorkflowId}
										onChange={(v) => setActiveWorkflowId(v as string)}
										prefix={<WorkflowIcon size={14} style={{ color: isTask ? "#8888a0" : "#a78bfa" }} />}
									>
										{activeWorkflows.map((w) => (
											<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
										))}
									</Select>
								)}
							</div>

							{/* Priority */}
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
								<div className="flex flex-wrap gap-1.5">
									{PRIORITY_OPTIONS.map((opt) => {
										const active = priority === opt.value;
										return (
											<button
												key={opt.value}
												onClick={() => setPriority(active ? "" : opt.value)}
												className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition-colors"
												style={active
													? { background: opt.bg, color: opt.text, borderColor: opt.border, fontWeight: 500 }
													: { background: "#1a1a1f", color: "#60607a", borderColor: "#2a2a35" }}
											>
												<span className="size-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />
												{opt.label}
											</button>
										);
									})}
								</div>
							</div>

							{/* Branch Name (task only) */}
							{isTask && (
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">Branch Name (optional)</span>
									<Input
										value={branchName}
										onChange={(e) => { setBranchName(e.target.value); setBranchNameEdited(true); }}
										placeholder="auto-generated from title"
										prefix={<GitBranch size={13} className="text-[#4a4a5a]" />}
									/>
								</div>
							)}

							{/* Base Branch */}
							<div className="flex flex-col gap-2">
								<span className="text-[11px] font-medium text-[#60607a]">Base Branch</span>
								<Select
									value={baseRef}
									onChange={(v) => setBaseRef(v as string)}
									placeholder="main"
									filterable
									prefix={<GitBranch size={13} className="text-[#8888a0]" />}
								>
									{branches.map((b) => (
										<SelectOption key={b} value={b} label={b} />
									))}
								</Select>
							</div>

							{/* Dependencies (task only) */}
							{isTask && (
								<div className="flex flex-col gap-2">
									<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
									<Select multiple value={dependsOn} onChange={(v) => setDependsOn(v)} placeholder="None" filterable clearable>
										{Object.values(allCards)
											.filter((c) => c.columnId !== "done")
											.map((c) => (
												<SelectOption
													key={c.id}
													value={c.id}
													label={c.title}
													hideCheckIcon
													className={({ selected }) => (selected ? "bg-gray-700" : "")}
												>
													<div className="flex items-center justify-between w-full gap-2 min-w-0">
														<span className="truncate text-sm">{c.title}</span>
														<span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700"}`}>
															{COLUMN_LABEL[c.columnId] ?? c.columnId}
														</span>
													</div>
												</SelectOption>
											))}
									</Select>
								</div>
							)}
						</div>

						{/* Footer */}
						<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
							<button onClick={() => setReadyForDev(!readyForDev)} className="flex items-center gap-1.5">
								<div
									className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
									style={{ background: readyForDev ? accentColor : "#2a2a35" }}
								>
									<div
										className="absolute top-0.5 size-3.5 rounded-full bg-white transition-transform"
										style={{ transform: `translateX(${readyForDev ? 14 : 2}px)` }}
									/>
								</div>
								<span className="text-[11px] text-[#8888a0]">Auto-start</span>
							</button>
							<div className="flex-1" />
							<button
								onClick={isTask ? handleCreateTask : handleCreateStory}
								disabled={loading || !title.trim() || (!isTask && subtasks.length === 0) || activeWorkflows.length === 0}
								className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
								style={{ background: accentColor }}
							>
								<Plus size={14} />
								{loading ? "Creating..." : isTask ? "Create Task" : "Create Story"}
							</button>
						</div>
					</div>
				</div>
			</div>

			{/* Subtask dialog (story mode) */}
			{!isTask && (
				<CreateSubtaskDialog
					open={subtaskDialogOpen}
					onClose={() => { setSubtaskDialogOpen(false); setEditingTempId(null); }}
					onSave={(subtask) => {
						setSubtasks((prev) => {
							const idx = prev.findIndex((s) => s.tempId === subtask.tempId);
							if (idx >= 0) { const next = [...prev]; next[idx] = subtask; return next; }
							return [...prev, subtask];
						});
						setSubtaskDialogOpen(false);
						setEditingTempId(null);
					}}
					allCards={allCards}
					workflows={workflows}
					draftSubtasks={subtasks}
					editingSubtask={editingSubtask}
					defaultBranch={baseRef}
					branches={branches}
				/>
			)}
		</>
	);
}
