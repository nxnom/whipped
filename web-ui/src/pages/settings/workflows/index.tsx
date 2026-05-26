import { ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, Workflow } from "@runtime-contract";
import { workflowSchema } from "@runtime-contract";
import { ArrowRight, ChevronRight, Layers, Plus, SquareCheckBig, Star, Trash2, Workflow as WorkflowIcon } from "lucide-react";
import { useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { WorkflowEditorDialog } from "./WorkflowEditorDialog";

function slotTypeColor(type: string): string {
	if (type === "dev") return "#3b82f6";
	if (type === "code_review") return "#f59e0b";
	if (type === "qa") return "#22c55e";
	if (type === "orch") return "#7c6aff";
	return "#8888a0";
}

function WorkflowCard({
	workflow,
	onClick,
	onDelete,
}: {
	workflow: Workflow;
	onClick: () => void;
	onDelete: (e: React.MouseEvent) => void;
}) {
	const sortedSlots = [...workflow.slots].sort((a, b) => a.order - b.order);
	const [hovered, setHovered] = useState(false);
	return (
		<div
			className="cursor-pointer transition-all"
			style={{
				background: "#141418",
				border: "1px solid #2a2a35",
				borderLeft: workflow.isDefault ? "3px solid #7c6aff" : "1px solid #2a2a35",
				borderRadius: 10,
				opacity: hovered ? 0.9 : 1,
			}}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div className="flex flex-col" style={{ padding: "16px 20px", gap: 12 }}>
				{/* Header row */}
				<div className="flex items-center gap-[10px]">
					<WorkflowIcon size={15} style={{ color: "#7c6aff", flexShrink: 0 }} />
					<span className="text-[13px] font-semibold" style={{ color: "#f0f0f5" }}>
						{workflow.name}
					</span>
					{workflow.isDefault && (
						<div
							className="flex items-center gap-1 shrink-0"
							style={{ background: "#7c6aff18", borderRadius: 4, padding: "2px 7px" }}
						>
							<Star size={9} style={{ color: "#7c6aff" }} />
							<span className="text-[10px] font-medium" style={{ color: "#7c6aff" }}>
								Default
							</span>
						</div>
					)}
					<div style={{ flex: 1 }} />
					<span className="text-[11px]" style={{ color: "#4a4a5a" }}>
						{workflow.slots.length} slots
					</span>
					{hovered && (
						<button
							onClick={onDelete}
							className="hover:opacity-80 transition-opacity shrink-0"
							style={{ padding: "2px 4px" }}
							title="Delete workflow"
						>
							<Trash2 size={13} style={{ color: "#ef4444" }} />
						</button>
					)}
					<ChevronRight size={15} style={{ color: "#3a3a45" }} />
				</div>
				{/* Slot pipeline */}
				<div className="flex items-center flex-wrap" style={{ gap: 6 }}>
					{sortedSlots.map((slot, idx) => (
						<div key={slot.id} className="flex items-center" style={{ gap: 6 }}>
							{idx > 0 && <ArrowRight size={11} style={{ color: "#2a2a35" }} />}
							<div
								className="flex items-center gap-[6px]"
								style={{
									background: "#0c0c0f",
									border: "1px solid #222228",
									borderRadius: 6,
									padding: "5px 9px",
									opacity: slot.enabled ? 1 : 0.35,
								}}
							>
								<div
									style={{
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: slot.enabled ? slotTypeColor(slot.type) : "#3a3a45",
										flexShrink: 0,
									}}
								/>
								<span className="text-[11px] font-medium" style={{ color: "#c0c0d0" }}>
									{slot.name}
								</span>
								<span className="font-mono text-[10px]" style={{ color: "#f59e0b80" }}>
									{slot.agentBinary}
								</span>
								{slot.model && (
									<span className="font-mono text-[10px]" style={{ color: "#3a3a45" }}>
										{slot.model}
									</span>
								)}
							</div>
						</div>
					))}
					{sortedSlots.length === 0 && (
						<span className="text-[11px]" style={{ color: "#3a3a45" }}>
							No slots
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

export function WorkflowsSection({
	workflows,
	workspaceId,
	defaultBinary,
	onChange,
}: {
	workflows: Workflow[];
	workspaceId: string;
	defaultBinary: RuntimeAgentId;
	onChange: (workflows: Workflow[]) => void;
}) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);

	const [activeTab, setActiveTab] = useState<"task" | "story">("task");
	const [openWorkflowId, setOpenWorkflowId] = useState<string | null>(null);
	const [draftWorkflow, setDraftWorkflow] = useState<Workflow | null>(null);

	const importFileRef = useRef<HTMLInputElement>(null);

	const visibleWorkflows = activeTab === "task" ? taskWorkflows : storyWorkflows;
	const openWorkflow = openWorkflowId ? workflows.find((w) => w.id === openWorkflowId) ?? null : null;

	const deleteWorkflow = (workflowId: string) => {
		const wf = workflows.find((w) => w.id === workflowId);
		ConfirmDialog.show({
			title: "Delete workflow",
			content: `Delete "${wf?.name ?? "this workflow"}"? This cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				onChange(workflows.filter((w) => w.id !== workflowId));
				trpc.workflows.delete.mutate({ workspaceId, workflowId }).catch(() => {
					toast.error("Failed to delete workflow");
				});
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const patchWorkflow = (wf: Workflow) => {
		trpc.workflows.upsert.mutate({ workspaceId, workflow: wf }).catch(() => {
			toast.error("Failed to save workflow");
		});
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
				? [{ id: "orch", type: "orch", name: "Orchestrator", agentBinary: defaultBinary, order: 0, enabled: true, prompt: "" }]
				: [{ id: "dev", type: "dev", name: "Dev", agentBinary: defaultBinary, order: 0, enabled: true, prompt: "" }],
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
			<div style={{ padding: "24px 40px 0 40px" }}>
				<div className="flex items-center" style={{ marginBottom: 4 }}>
					<span className="text-[20px] font-semibold" style={{ color: "#f0f0f5" }}>
						Workflows
					</span>
					<div style={{ flex: 1 }} />
					<input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
					<button
						onClick={handleAddWorkflow}
						className="flex items-center gap-[6px] hover:opacity-80 transition-opacity"
						style={{ background: "#7c6aff", borderRadius: 6, padding: "8px 14px" }}
					>
						<Plus size={14} style={{ color: "#ffffff" }} />
						<span className="text-[12px] font-medium" style={{ color: "#ffffff" }}>
							New Workflow
						</span>
					</button>
				</div>
				<p className="text-[13px]" style={{ color: "#60607a" }}>
					Define agent pipelines for tasks and stories
				</p>
			</div>

			{/* Tab bar */}
			<div
				className="flex shrink-0"
				style={{ padding: "0 40px", borderBottom: "1px solid #2a2a35" }}
			>
				<button
					onClick={() => setActiveTab("task")}
					className="flex items-center gap-[6px]"
					style={{
						padding: "12px 20px",
						background: activeTab === "task" ? "#7c6aff08" : "transparent",
						borderBottom: activeTab === "task" ? "2px solid #7c6aff" : "2px solid transparent",
					}}
				>
					<SquareCheckBig size={14} style={{ color: activeTab === "task" ? "#7c6aff" : "#60607a" }} />
					<span
						className="text-[13px]"
						style={{
							color: activeTab === "task" ? "#f0f0f5" : "#8888a0",
							fontWeight: activeTab === "task" ? 600 : 400,
						}}
					>
						Task Workflows
					</span>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							background: activeTab === "task" ? "#7c6aff20" : "#1a1a1f",
							borderRadius: 999,
							padding: "1px 7px",
						}}
					>
						<span
							className="text-[10px] font-semibold"
							style={{ color: activeTab === "task" ? "#7c6aff" : "#60607a" }}
						>
							{taskWorkflows.length}
						</span>
					</div>
				</button>
				<button
					onClick={() => setActiveTab("story")}
					className="flex items-center gap-[6px]"
					style={{
						padding: "12px 20px",
						background: activeTab === "story" ? "#7c6aff08" : "transparent",
						borderBottom: activeTab === "story" ? "2px solid #7c6aff" : "2px solid transparent",
					}}
				>
					<Layers size={14} style={{ color: activeTab === "story" ? "#7c6aff" : "#60607a" }} />
					<span
						className="text-[13px]"
						style={{
							color: activeTab === "story" ? "#f0f0f5" : "#8888a0",
							fontWeight: activeTab === "story" ? 600 : 400,
						}}
					>
						Story Workflows
					</span>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							background: activeTab === "story" ? "#7c6aff20" : "#1a1a1f",
							borderRadius: 999,
							padding: "1px 7px",
						}}
					>
						<span
							className="text-[10px] font-semibold"
							style={{ color: activeTab === "story" ? "#7c6aff" : "#60607a" }}
						>
							{storyWorkflows.length}
						</span>
					</div>
				</button>
			</div>

			{/* Workflow cards */}
			<div className="flex-1 overflow-y-auto" style={{ padding: "20px 40px" }}>
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
					/>
					))}
					{visibleWorkflows.length === 0 && (
						<div
							className="flex flex-col items-center justify-center py-16 gap-3"
							style={{ color: "#4a4a5a" }}
						>
							<WorkflowIcon size={28} style={{ color: "#2a2a35" }} />
							<p className="text-[13px]">No workflows yet</p>
							<button
								onClick={handleAddWorkflow}
								className="flex items-center gap-[6px] hover:opacity-80 transition-opacity"
								style={{ background: "#7c6aff", borderRadius: 6, padding: "8px 14px" }}
							>
								<Plus size={13} style={{ color: "#ffffff" }} />
								<span className="text-[12px] font-medium" style={{ color: "#ffffff" }}>
									New Workflow
								</span>
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
