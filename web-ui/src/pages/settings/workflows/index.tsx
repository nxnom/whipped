import { ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, Workflow } from "@runtime-contract";
import { EMPTY_INLINE_PROMPT, workflowSchema } from "@runtime-contract";
import {
	ArrowRight,
	ChevronRight,
	Layers,
	Plus,
	SquareCheckBig,
	Star,
	Trash2,
	Workflow as WorkflowIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { WorkflowEditorDialog } from "./WorkflowEditorDialog";
import { defaultSlotModelFields } from "./WorkflowEditorDialog/constants";

function slotTypeColor(type: string): string {
	if (type === "dev") return "#3b82f6";
	if (type === "plan") return "#eab308";
	if (type === "review") return "#22c55e";
	if (type === "orch") return "#7c6aff";
	return "#8888a0";
}

function WorkflowCard({
	workflow,
	onClick,
	onDelete,
	onSetDefault,
}: {
	workflow: Workflow;
	onClick: () => void;
	onDelete: (e: React.MouseEvent) => void;
	onSetDefault: (e: React.MouseEvent) => void;
}) {
	const sortedSlots = [...workflow.slots].sort((a, b) => {
		if (a.type === "plan" && b.type !== "plan") return -1;
		if (b.type === "plan" && a.type !== "plan") return 1;
		return a.order - b.order;
	});
	const [hovered, setHovered] = useState(false);
	return (
		<div
			className="cursor-pointer transition-all bg-[#141418] border border-[#2a2a35] rounded-[10px]"
			style={{
				borderLeft: workflow.isDefault ? "3px solid #7c6aff" : "1px solid #2a2a35",
				opacity: hovered ? 0.9 : 1,
			}}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="flex flex-col px-5 py-4 gap-3">
				{/* Header row */}
				<div className="flex items-center gap-[10px]">
					<WorkflowIcon size={15} className="text-[#7c6aff] shrink-0" />
					<span className="text-[13px] font-semibold text-[#f0f0f5]">{workflow.name}</span>
					{workflow.isDefault && (
						<div className="flex items-center gap-1 shrink-0 bg-[#7c6aff18] rounded-[4px] px-[7px] py-[2px]">
							<Star size={9} className="text-[#7c6aff]" />
							<span className="text-[10px] font-medium text-[#7c6aff]">Default</span>
						</div>
					)}
					<div className="flex-1" />
					<span className="text-[11px] text-[#4a4a5a]">{workflow.slots.length} slots</span>
					{hovered && !workflow.isDefault && (
						<button
							onClick={onSetDefault}
							className="hover:opacity-80 transition-opacity shrink-0 px-1 py-[2px]"
							title="Set as default"
						>
							<Star size={13} className="text-[#7c6aff]" />
						</button>
					)}
					{hovered && (
						<button
							onClick={onDelete}
							className="hover:opacity-80 transition-opacity shrink-0 px-1 py-[2px]"
							title="Delete workflow"
						>
							<Trash2 size={13} className="text-[#ef4444]" />
						</button>
					)}
					<ChevronRight size={15} className="text-[#3a3a45]" />
				</div>
				{/* Slot pipeline */}
				<div className="flex items-center flex-wrap gap-1.5">
					{sortedSlots.map((slot, idx) => {
						const prev = sortedSlots[idx - 1];
						const showArrow = idx > 0 && !(prev?.type === "plan" && !prev.rerun);
						return (
							<div key={slot.id} className="flex items-center gap-1.5">
								{showArrow && <ArrowRight size={11} className="text-[#2a2a35]" />}
								<div
									className="flex items-center gap-[6px] bg-[#0c0c0f] border border-[#222228] rounded-md px-[9px] py-[5px]"
									style={{ opacity: slot.enabled ? 1 : 0.35 }}
								>
									<div
										className="w-[7px] h-[7px] rounded-full shrink-0"
										style={{ background: slot.enabled ? slotTypeColor(slot.type) : "#3a3a45" }}
									/>
									<span className="text-[11px] font-medium text-[#c0c0d0]">{slot.name}</span>
									{(() => {
										const def = slot.pairs.find((p) => p.id === slot.defaultPairId) ?? slot.pairs[0];
										return (
											<>
												<span className="font-mono text-[10px] text-[#f59e0b80]">{def?.binary}</span>
												{def?.model && <span className="font-mono text-[10px] text-[#3a3a45]">{def.model}</span>}
											</>
										);
									})()}
								</div>
							</div>
						);
					})}
					{sortedSlots.length === 0 && <span className="text-[11px] text-[#3a3a45]">No slots</span>}
				</div>
			</div>
		</div>
	);
}

export function WorkflowsSection({
	workflows,
	workspaceId,
	repoPath,
	defaultBinary,
	onChange,
}: {
	workflows: Workflow[];
	workspaceId: string;
	repoPath: string;
	defaultBinary: RuntimeAgentId;
	onChange: (workflows: Workflow[]) => void;
}) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);

	const [activeTab, setActiveTab] = useState<"task" | "story">("task");
	const [openWorkflowId, setOpenWorkflowId] = useState<string | null>(null);
	const [draftWorkflow, setDraftWorkflow] = useState<Workflow | null>(null);

	const importFileRef = useRef<HTMLInputElement>(null);

	const { trigger: upsertWorkflow } = useWrite((api) => api("workflows").POST());
	const { trigger: deleteWorkflowRequest } = useWrite((api) => api("workflows/:workflowId").DELETE());

	const visibleWorkflows = activeTab === "task" ? taskWorkflows : storyWorkflows;
	const openWorkflow = openWorkflowId ? (workflows.find((w) => w.id === openWorkflowId) ?? null) : null;

	const deleteWorkflow = (workflowId: string) => {
		const wf = workflows.find((w) => w.id === workflowId);
		ConfirmDialog.show({
			title: "Delete workflow",
			content: `Delete "${wf?.name ?? "this workflow"}"? This cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				onChange(workflows.filter((w) => w.id !== workflowId));
				void deleteWorkflowRequest({ params: { workflowId }, query: { workspaceId } }).then((res) => {
					if (res.error) toast.error("Failed to delete workflow");
				});
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const patchWorkflow = (wf: Workflow) => {
		void upsertWorkflow({ body: { workspaceId, workflow: wf } }).then((res) => {
			if (res.error) toast.error("Failed to save workflow");
		});
	};

	const handleSetDefault = (workflowId: string) => {
		const target = workflows.find((w) => w.id === workflowId);
		if (!target || target.isDefault) return;
		const updated = workflows.map((w) => {
			if (w.forStory !== target.forStory) return w;
			const next = { ...w, isDefault: w.id === workflowId };
			if (next.isDefault !== w.isDefault) patchWorkflow(next);
			return next;
		});
		onChange(updated);
	};

	const updateWorkflow = (updated: Workflow) => {
		onChange(workflows.map((w) => (w.id === updated.id ? updated : w)));
		patchWorkflow(updated);
	};

	const handleAddWorkflow = () => {
		const id = `wf_${Date.now()}`;
		const isStory = activeTab === "story";
		const newWf: Workflow = {
			id,
			name: "New Workflow",
			isDefault: isStory ? storyWorkflows.length === 0 : taskWorkflows.length === 0,
			forStory: isStory,
			slots: isStory
				? [
						{
							id: "orch",
							type: "orch",
							name: "Orchestrator",
							order: 0,
							enabled: true,
							prompt: EMPTY_INLINE_PROMPT,
							...defaultSlotModelFields(defaultBinary),
							tools: [],
							canAdjustLevel: false,
							rerun: false,
						},
					]
				: [
						{
							id: "dev",
							type: "dev",
							name: "Dev",
							order: 0,
							enabled: true,
							prompt: EMPTY_INLINE_PROMPT,
							...defaultSlotModelFields(defaultBinary),
							tools: [],
							canAdjustLevel: false,
							rerun: false,
						},
					],
		};
		setDraftWorkflow(newWf);
	};

	const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const raw = JSON.parse(ev.target?.result as string);
				const parsed = workflowSchema.safeParse(raw);
				if (!parsed.success) {
					toast.error(`Invalid workflow file: ${parsed.error.issues[0]?.message}`);
					return;
				}
				const imported: Workflow = { ...parsed.data, id: `wf_${Date.now()}`, isDefault: false };
				onChange([...workflows, imported]);
				patchWorkflow(imported);
				setActiveTab(imported.forStory ? "story" : "task");
				setOpenWorkflowId(imported.id);
				toast.success(`Imported "${imported.name}"`);
			} catch {
				toast.error("Failed to parse workflow file");
			}
		};
		reader.readAsText(file);
	};

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			{/* Page header */}
			<div className="px-10 pt-6">
				<div className="flex items-center mb-1">
					<span className="text-[20px] font-semibold text-[#f0f0f5]">Workflows</span>
					<div className="flex-1" />
					<input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
					<button
						onClick={handleAddWorkflow}
						className="flex items-center gap-1.5 hover:opacity-80 transition-opacity bg-[#7c6aff] rounded-md px-3.5 py-2"
					>
						<Plus size={14} className="text-white" />
						<span className="text-[12px] font-medium text-white">New Workflow</span>
					</button>
				</div>
				<p className="text-[13px] text-[#60607a]">Define agent pipelines for tasks and stories</p>
			</div>

			{/* Tab bar */}
			<div className="flex shrink-0 px-10 border-b border-[#2a2a35]">
				<button
					onClick={() => setActiveTab("task")}
					className={classNames(
						"flex items-center gap-1.5 px-5 py-3 border-b-2",
						activeTab === "task" ? "bg-[#7c6aff08] border-[#7c6aff]" : "bg-transparent border-transparent",
					)}
				>
					<SquareCheckBig size={14} className={activeTab === "task" ? "text-[#7c6aff]" : "text-[#60607a]"} />
					<span
						className={classNames(
							"text-[13px]",
							activeTab === "task" ? "text-[#f0f0f5] font-semibold" : "text-[#8888a0]",
						)}
					>
						Task Workflows
					</span>
					<div
						className={classNames(
							"flex items-center rounded-full px-[7px] py-[1px]",
							activeTab === "task" ? "bg-[#7c6aff20]" : "bg-[#1a1a1f]",
						)}
					>
						<span
							className={classNames(
								"text-[10px] font-semibold",
								activeTab === "task" ? "text-[#7c6aff]" : "text-[#60607a]",
							)}
						>
							{taskWorkflows.length}
						</span>
					</div>
				</button>
				<button
					onClick={() => setActiveTab("story")}
					className={classNames(
						"flex items-center gap-1.5 px-5 py-3 border-b-2",
						activeTab === "story" ? "bg-[#7c6aff08] border-[#7c6aff]" : "bg-transparent border-transparent",
					)}
				>
					<Layers size={14} className={activeTab === "story" ? "text-[#7c6aff]" : "text-[#60607a]"} />
					<span
						className={classNames(
							"text-[13px]",
							activeTab === "story" ? "text-[#f0f0f5] font-semibold" : "text-[#8888a0]",
						)}
					>
						Story Workflows
					</span>
					<div
						className={classNames(
							"flex items-center rounded-full px-[7px] py-[1px]",
							activeTab === "story" ? "bg-[#7c6aff20]" : "bg-[#1a1a1f]",
						)}
					>
						<span
							className={classNames(
								"text-[10px] font-semibold",
								activeTab === "story" ? "text-[#7c6aff]" : "text-[#60607a]",
							)}
						>
							{storyWorkflows.length}
						</span>
					</div>
				</button>
			</div>

			{/* Workflow cards */}
			<div className="flex-1 overflow-y-auto px-10 py-5">
				<div className="flex flex-col gap-3">
					{visibleWorkflows.map((wf) => (
						<WorkflowCard
							key={wf.id}
							workflow={wf}
							onClick={() => setOpenWorkflowId(wf.id)}
							onDelete={(e) => {
								e.stopPropagation();
								deleteWorkflow(wf.id);
							}}
							onSetDefault={(e) => {
								e.stopPropagation();
								handleSetDefault(wf.id);
							}}
						/>
					))}
					{visibleWorkflows.length === 0 && (
						<div className="flex flex-col items-center justify-center py-16 gap-3 text-[#4a4a5a]">
							<WorkflowIcon size={28} className="text-[#2a2a35]" />
							<p className="text-[13px]">No workflows yet</p>
							<button
								onClick={handleAddWorkflow}
								className="flex items-center gap-1.5 hover:opacity-80 transition-opacity bg-[#7c6aff] rounded-md px-3.5 py-2"
							>
								<Plus size={13} className="text-white" />
								<span className="text-[12px] font-medium text-white">New Workflow</span>
							</button>
						</div>
					)}
				</div>
			</div>

			{/* Edit existing workflow */}
			{openWorkflow && (
				<WorkflowEditorDialog
					workflow={openWorkflow}
					defaultBinary={defaultBinary}
					workspaceId={workspaceId}
					repoPath={repoPath}
					onUpdate={updateWorkflow}
					onSave={updateWorkflow}
					onClose={() => setOpenWorkflowId(null)}
				/>
			)}

			{/* Create new workflow (draft — not saved until Create is clicked) */}
			{draftWorkflow && (
				<WorkflowEditorDialog
					workflow={draftWorkflow}
					defaultBinary={defaultBinary}
					workspaceId={workspaceId}
					repoPath={repoPath}
					isNew
					onUpdate={() => {}}
					onSave={(wf) => {
						onChange([...workflows, wf]);
						patchWorkflow(wf);
						setActiveTab(wf.forStory ? "story" : "task");
						setDraftWorkflow(null);
					}}
					onClose={() => setDraftWorkflow(null)}
				/>
			)}
		</div>
	);
}
