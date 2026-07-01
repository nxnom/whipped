import { RHFInput, RHFSelect, SelectOption, Switch } from "@geckoui/geckoui";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { highestWorkflowLevel, type RuntimeBoardCard, type Workflow } from "@runtime-contract";
import { GitBranch, Plus, Workflow as WorkflowIcon } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { COLUMN_BADGE, COLUMN_LABEL } from "./constants";
import { PriorityField } from "./PriorityField";
import { snapshotFormModelConfig } from "./tiers";
import { TicketTiersSection } from "./TicketTiersSection";

interface CreateTaskConfigSidebarProps {
	isTask: boolean;
	accentColor: string;
	activeWorkflows: Workflow[];
	branches: string[];
	allCards: Record<string, RuntimeBoardCard>;
	readyForDev: boolean;
	onToggleReadyForDev: () => void;
	onBranchNameEdited: () => void;
	onNoWorkflows: () => void;
	onSubmit: () => void;
	submitDisabled: boolean;
	submitLabel: string;
}

export function CreateTaskConfigSidebar({
	isTask,
	accentColor,
	activeWorkflows,
	branches,
	allCards,
	readyForDev,
	onToggleReadyForDev,
	onBranchNameEdited,
	onNoWorkflows,
	onSubmit,
	submitDisabled,
	submitLabel,
}: CreateTaskConfigSidebarProps) {
	// dependsOn (stacking) and waitsFor (gate) are mutually exclusive — choose one via the toggle.
	const { control, setValue } = useFormContext();
	const selectedWorkflowId = useWatch({ control, name: "workflowId" }) as string | undefined;
	const selectedWorkflow = activeWorkflows.find((w) => w.id === selectedWorkflowId);
	const [relationMode, setRelationMode] = useState<"waitsFor" | "dependsOn">("waitsFor");

	// Reseed the per-ticket tiers from the newly chosen workflow (drops prior edits,
	// since slots differ between workflows).
	const onWorkflowChange = (id: string) => {
		const wf = activeWorkflows.find((w) => w.id === id);
		setValue("activeLevel", highestWorkflowLevel(wf), { shouldDirty: true });
		setValue("modelConfig", snapshotFormModelConfig(wf), { shouldDirty: true });
	};
	const switchRelationMode = (mode: "waitsFor" | "dependsOn") => {
		setRelationMode(mode);
		if (mode === "waitsFor") setValue("dependsOn", "");
		else setValue("waitsFor", []);
	};
	return (
		<div className="w-80 shrink-0 bg-[#111111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
			{/* Config header */}
			<div className="px-[18px] py-3.5 border-b border-[#2a2a2a] shrink-0">
				<span className="text-xs font-semibold text-[#8a8f98]">Configuration</span>
			</div>

			{/* Config fields */}
			<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
				{/* Workflow */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#5f6672]">
						{isTask ? "Workflow" : "Orchestrator Workflow"}
					</span>
					{activeWorkflows.length === 0 ? (
						<button
							className="text-[11px] text-[#eab308] hover:text-[#eab308] underline text-left transition-colors"
							onClick={onNoWorkflows}
						>
							No workflows — create one in Settings
						</button>
					) : (
						<RHFSelect
							name="workflowId"
							onChange={onWorkflowChange}
							prefix={<WorkflowIcon size={14} style={{ color: isTask ? "#8a8f98" : "#f5f5f5" }} />}
						>
							{activeWorkflows.map((w) => (
								<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
							))}
						</RHFSelect>
					)}
				</div>

				{/* Model tiers */}
				<TicketTiersSection workflow={selectedWorkflow} />

				{/* Priority */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#5f6672]">Priority</span>
					<PriorityField name="priority" />
				</div>

				{/* Branch Name (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-[#5f6672]">Branch Name (optional)</span>
						<RHFInput
							name="branchName"
							onChange={onBranchNameEdited}
							placeholder="auto-generated from description"
							prefix={<GitBranch size={13} className="text-[#5f6672]" />}
						/>
					</div>
				)}

				{/* Base Branch */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#5f6672]">Base Branch</span>
					<RHFSelect
						name="baseRef"
						placeholder="main"
						filterable
						prefix={<GitBranch size={13} className="text-[#8a8f98]" />}
					>
						{branches.map((b) => (
							<SelectOption key={b} value={b} label={b} />
						))}
					</RHFSelect>
				</div>

				{/* Dependencies (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-[#5f6672]">Relation</span>
						<div className="flex gap-1 rounded-md bg-[#111111] border border-[#2a2a2a] p-0.5">
							<button
								type="button"
								onClick={() => switchRelationMode("waitsFor")}
								className={classNames(
									"flex-1 rounded py-1 text-[11px] transition-colors",
									relationMode === "waitsFor" ? "bg-[#2a2a2a] text-[#ededed]" : "text-[#5f6672] hover:text-[#ededed]",
								)}
							>
								Waits for
							</button>
							<button
								type="button"
								onClick={() => switchRelationMode("dependsOn")}
								className={classNames(
									"flex-1 rounded py-1 text-[11px] transition-colors",
									relationMode === "dependsOn" ? "bg-[#2a2a2a] text-[#ededed]" : "text-[#5f6672] hover:text-[#ededed]",
								)}
							>
								Depends on
							</button>
						</div>
						{relationMode === "waitsFor" ? (
							<>
								<span className="text-[10px] text-[#5f6672] -mt-1">
									Starts in a fresh branch once all of these are merged
								</span>
								<RHFSelect name="waitsFor" multiple placeholder="None" filterable clearable>
									{Object.values(allCards)
										.filter((c) => c.columnId !== "done")
										.map((c) => {
											const cDisplay = c.description?.split("\n")[0] ?? c.id;
											return (
												<SelectOption
													key={c.id}
													value={c.id}
													label={cDisplay}
													hideCheckIcon
													className={({ selected }) => (selected ? "bg-[#2a2a2a]" : "")}
												>
													<div className="flex items-center justify-between w-full gap-2 min-w-0">
														<span className="truncate text-sm">{cDisplay}</span>
														<span
															className={classNames(
																"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																COLUMN_BADGE[c.columnId] ?? "text-[#8a8f98] bg-[#2a2a2a]",
															)}
														>
															{COLUMN_LABEL[c.columnId] ?? c.columnId}
														</span>
													</div>
												</SelectOption>
											);
										})}
								</RHFSelect>
							</>
						) : (
							<>
								<span className="text-[10px] text-[#5f6672] -mt-1">
									Continues in one ticket's branch once it reaches review
								</span>
								<RHFSelect name="dependsOn" placeholder="None" filterable clearable>
									{Object.values(allCards)
										.filter((c) => c.columnId !== "done")
										.map((c) => {
											const cDisplay = c.description?.split("\n")[0] ?? c.id;
											return (
												<SelectOption
													key={c.id}
													value={c.id}
													label={cDisplay}
													hideCheckIcon
													className={({ selected }) => (selected ? "bg-[#2a2a2a]" : "")}
												>
													<div className="flex items-center justify-between w-full gap-2 min-w-0">
														<span className="truncate text-sm">{cDisplay}</span>
														<span
															className={classNames(
																"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																COLUMN_BADGE[c.columnId] ?? "text-[#8a8f98] bg-[#2a2a2a]",
															)}
														>
															{COLUMN_LABEL[c.columnId] ?? c.columnId}
														</span>
													</div>
												</SelectOption>
											);
										})}
								</RHFSelect>
							</>
						)}
					</div>
				)}
			</div>

			{/* Footer */}
			<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a2a] shrink-0">
				<label className="flex items-center gap-1.5 cursor-pointer">
					<Switch size="sm" checked={readyForDev} onChange={onToggleReadyForDev} />
					<span className="text-[11px] text-[#8a8f98]">Auto-start</span>
				</label>
				<div className="flex-1" />
				<button
					onClick={onSubmit}
					disabled={submitDisabled}
					className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
					style={{ background: accentColor }}
				>
					<Plus size={14} />
					{submitLabel}
				</button>
			</div>
		</div>
	);
}
