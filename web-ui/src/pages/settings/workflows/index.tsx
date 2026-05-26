import { ConfirmDialog, Input, toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, Workflow, WorkflowSlot } from "@runtime-contract";
import { workflowSchema } from "@runtime-contract";
import { Bot, Check, Download, Layers, Plus, Star, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { AgentSlotDialog } from "./AgentSlotDialog";
import { AddCustomAgentDialog } from "./AddCustomAgentDialog";
import { WorkflowEditor } from "./WorkflowEditor";

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
	const [selectedId, setSelectedId] = useState<string>(
		taskWorkflows.find((w) => w.isDefault)?.id ?? taskWorkflows[0]?.id ?? "",
	);
	const [editingSlot, setEditingSlot] = useState<{ wfId: string; slot: WorkflowSlot } | null>(null);
	const [addingCustomTo, setAddingCustomTo] = useState<string | null>(null);
	const [addingOrchTo, setAddingOrchTo] = useState<string | null>(null);
	const [pendingName, setPendingName] = useState<string>(
		workflows.find((w) => w.id === selectedId)?.name ?? "",
	);

	const visibleWorkflows = activeTab === "task" ? taskWorkflows : storyWorkflows;
	const selectedWorkflow = workflows.find((w) => w.id === selectedId);

	useEffect(() => {
		setPendingName(workflows.find((w) => w.id === selectedId)?.name ?? "");
	}, [selectedId]);

	const patchWorkflow = (wf: Workflow) => {
		trpc.workflows.upsert.mutate({ workspaceId, workflow: wf }).catch(() => {
			toast.error("Failed to save workflow");
		});
	};

	const deleteWorkflow = (workflowId: string) => {
		trpc.workflows.delete.mutate({ workspaceId, workflowId }).catch(() => {
			toast.error("Failed to delete workflow");
		});
	};

	const handleTabSwitch = (tab: "task" | "story") => {
		setActiveTab(tab);
		const list = tab === "task" ? taskWorkflows : storyWorkflows;
		setSelectedId(list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? "");
	};

	const updateWorkflow = (updated: Workflow) => {
		onChange(workflows.map((w) => (w.id === updated.id ? updated : w)));
		patchWorkflow(updated);
	};

	const handleAddWorkflow = () => {
		const id = `wf_${Date.now()}`;
		const newWf: Workflow = {
			id,
			name: "New Workflow",
			isDefault: false,
			forStory: false,
			slots: [{ id: "dev", type: "dev", name: "Dev", agentBinary: defaultBinary, order: 0, enabled: true, prompt: "" }],
		};
		onChange([...workflows, newWf]);
		setActiveTab("task");
		setSelectedId(id);
		setPendingName(newWf.name);
		patchWorkflow(newWf);
	};

	const handleAddStoryWorkflow = () => {
		const id = `wf_story_${Date.now()}`;
		const newWf: Workflow = {
			id,
			name: "New Story Workflow",
			isDefault: false,
			forStory: true,
			slots: [
				{ id: "orch", type: "orch", name: "Orchestrator", agentBinary: defaultBinary, order: 0, enabled: true, prompt: "" },
			],
		};
		onChange([...workflows, newWf]);
		setActiveTab("story");
		setSelectedId(id);
		setPendingName(newWf.name);
		patchWorkflow(newWf);
	};

	const handleSetDefault = (workflowId: string) => {
		const target = workflows.find((w) => w.id === workflowId);
		if (!target) return;
		const updated = workflows.map((w) => (w.forStory === target.forStory ? { ...w, isDefault: w.id === workflowId } : w));
		onChange(updated);
		updated.filter((w) => w.forStory === target.forStory).forEach((wf) => patchWorkflow(wf));
	};

	const handleDeleteWorkflow = (workflowId: string) => {
		const wf = workflows.find((w) => w.id === workflowId);
		ConfirmDialog.show({
			title: "Delete workflow",
			content: `Delete "${wf?.name ?? "this workflow"}"? This cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				const updated = workflows.filter((w) => w.id !== workflowId);
				onChange(updated);
				if (selectedId === workflowId) {
					const remaining = updated.filter((w) => (activeTab === "task" ? !w.forStory : w.forStory));
					setSelectedId(remaining.find((w) => w.isDefault)?.id ?? remaining[0]?.id ?? "");
				}
				deleteWorkflow(workflowId);
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleSaveName = () => {
		if (!selectedWorkflow || pendingName === selectedWorkflow.name) return;
		updateWorkflow({ ...selectedWorkflow, name: pendingName });
	};

	const importFileRef = useRef<HTMLInputElement>(null);

	const handleExport = (wf: Workflow) => {
		const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${wf.name.toLowerCase().replace(/\s+/g, "-")}.workflow.json`;
		a.click();
		URL.revokeObjectURL(url);
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
				setActiveTab(imported.forStory ? "story" : "task");
				setSelectedId(imported.id);
				setPendingName(imported.name);
				patchWorkflow(imported);
				toast.success(`Imported "${imported.name}"`);
			} catch {
				toast.error("Failed to parse workflow file");
			}
		};
		reader.readAsText(file);
	};

	const handleSaveSlot = (updatedSlot: WorkflowSlot) => {
		if (!editingSlot) return;
		const wf = workflows.find((w) => w.id === editingSlot.wfId);
		if (!wf) return;
		updateWorkflow({ ...wf, slots: wf.slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s)) });
		setEditingSlot(null);
	};

	return (
		<div className="flex flex-col h-full">
			{/* Tab bar */}
			<div className="shrink-0 flex border-b border-gray-800">
				<button
					onClick={() => handleTabSwitch("task")}
					className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors
						${activeTab === "task" ? "border-blue-500 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
				>
					<Bot size={13} />
					Task Workflows
					<span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeTab === "task" ? "bg-blue-500/20 text-blue-400" : "bg-gray-800 text-gray-500"}`}>
						{taskWorkflows.length}
					</span>
				</button>
				<button
					onClick={() => handleTabSwitch("story")}
					className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors
						${activeTab === "story" ? "border-purple-500 text-purple-200" : "border-transparent text-gray-500 hover:text-gray-300"}`}
				>
					<Layers size={13} />
					Story Workflows
					<span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeTab === "story" ? "bg-purple-500/20 text-purple-400" : "bg-gray-800 text-gray-500"}`}>
						{storyWorkflows.length}
					</span>
				</button>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* Left: workflow list */}
				<div className="w-52 shrink-0 border-r border-gray-800 flex flex-col">
					<div className="flex-1 overflow-y-auto py-1">
						{visibleWorkflows.map((w) => (
							<button
								key={w.id}
								onClick={() => setSelectedId(w.id)}
								className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm transition-colors
								${selectedId === w.id
									? activeTab === "story" ? "bg-purple-900/40 text-purple-200" : "bg-gray-800 text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-gray-900/50"
								}`}
							>
								{activeTab === "story" && <Layers size={12} className="shrink-0 text-purple-500" />}
								<span className="flex-1 truncate">{w.name}</span>
								{w.isDefault && <Star size={10} className="shrink-0 text-yellow-500 fill-yellow-500" />}
							</button>
						))}
						{visibleWorkflows.length === 0 && <p className="px-4 py-4 text-xs text-gray-600">No workflows yet</p>}
					</div>
					<div className="border-t border-gray-800 p-3 flex flex-col gap-0.5">
						<input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
						{activeTab === "task" ? (
							<button
								onClick={handleAddWorkflow}
								className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors px-1 py-1.5 rounded"
							>
								<Plus size={11} /> New Workflow
							</button>
						) : (
							<button
								onClick={handleAddStoryWorkflow}
								className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-400 transition-colors px-1 py-1.5 rounded"
							>
								<Plus size={11} /> New Workflow
							</button>
						)}
						<button
							onClick={() => importFileRef.current?.click()}
							className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 transition-colors px-1 py-1.5 rounded"
						>
							<Upload size={11} /> Import Workflow
						</button>
					</div>
				</div>

				{/* Right: editor */}
				<div className="flex-1 overflow-hidden flex flex-col">
					{selectedWorkflow ? (
						<>
							{/* Header */}
							<div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-800">
								<div className="flex items-center gap-1 max-w-xs">
									<Input
										value={pendingName}
										onChange={(e) => setPendingName(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
										inputClassName="font-semibold text-sm"
									/>
									{pendingName !== selectedWorkflow.name && (
										<button
											onClick={handleSaveName}
											className="p-1.5 rounded text-green-400 hover:bg-gray-800 transition-colors shrink-0"
											title="Save name"
										>
											<Check size={14} />
										</button>
									)}
								</div>
								{selectedWorkflow.forStory && (
									<span className="flex items-center gap-1 text-[10px] text-purple-400 bg-purple-400/10 px-2 py-1 rounded font-medium shrink-0">
										<Layers size={10} /> story
									</span>
								)}
								<div className="ml-auto flex items-center gap-1">
									<button
										onClick={() => handleSetDefault(selectedWorkflow.id)}
										className={`flex items-center gap-1 p-1.5 rounded transition-colors text-xs ${
											selectedWorkflow.isDefault
												? "text-yellow-500 bg-yellow-500/10"
												: "text-gray-500 hover:text-yellow-400 hover:bg-gray-800"
										}`}
										title={selectedWorkflow.isDefault ? "Default workflow" : "Set as default"}
									>
										<Star size={13} className={selectedWorkflow.isDefault ? "fill-yellow-500" : ""} />
										{selectedWorkflow.isDefault ? "Default" : "Set default"}
									</button>
									<button
										onClick={() => handleExport(selectedWorkflow)}
										className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-gray-800 transition-colors"
										title="Export workflow as JSON"
									>
										<Download size={14} />
									</button>
									<button
										onClick={() => handleDeleteWorkflow(selectedWorkflow.id)}
										className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
										title="Delete workflow"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>

							{/* Slot editor */}
							<div className="flex-1 overflow-y-auto p-6">
								<WorkflowEditor
									workflow={selectedWorkflow}
									defaultBinary={defaultBinary}
									onUpdate={updateWorkflow}
									onEditSlot={(slot) => setEditingSlot({ wfId: selectedWorkflow.id, slot })}
									onAddCustom={() => setAddingCustomTo(selectedWorkflow.id)}
									onAddOrch={() => setAddingOrchTo(selectedWorkflow.id)}
								/>
							</div>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-sm text-gray-600">
							Select a workflow to edit
						</div>
					)}
				</div>
			</div>

			{editingSlot && (
				<AgentSlotDialog slot={editingSlot.slot} onSave={handleSaveSlot} onClose={() => setEditingSlot(null)} />
			)}

			{addingCustomTo !== null && (
				<AddCustomAgentDialog
					defaultBinary={defaultBinary}
					onAdd={(name, binary, model, effort, prompt) => {
						const wf = workflows.find((w) => w.id === addingCustomTo);
						if (!wf) return;
						const maxOrder = wf.slots.reduce((m, s) => Math.max(m, s.order), 0);
						updateWorkflow({ ...wf, slots: [...wf.slots, { id: `slot_custom_${Date.now()}`, type: "custom", name, agentBinary: binary, model, effort, order: maxOrder + 1, enabled: true, prompt }] });
						setAddingCustomTo(null);
					}}
					onClose={() => setAddingCustomTo(null)}
				/>
			)}

			{addingOrchTo !== null && (
				<AddCustomAgentDialog
					defaultBinary={defaultBinary}
					title="Add Orch Agent"
					onAdd={(name, binary, model, effort, prompt) => {
						const wf = workflows.find((w) => w.id === addingOrchTo);
						if (!wf) return;
						const maxOrder = wf.slots.reduce((m, s) => Math.max(m, s.order), 0);
						updateWorkflow({ ...wf, slots: [...wf.slots, { id: `slot_orch_${Date.now()}`, type: "orch", name, agentBinary: binary, model, effort, order: maxOrder + 1, enabled: true, prompt }] });
						setAddingOrchTo(null);
					}}
					onClose={() => setAddingOrchTo(null)}
				/>
			)}
		</div>
	);
}
