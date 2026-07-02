import { Button, RHFInput, RHFSelect, SelectOption, Switch } from "@geckoui/geckoui";
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
		<div className="w-80 shrink-0 bg-whip-bg border-l border-whip-border flex flex-col overflow-hidden">
			{/* Config header */}
			<div className="px-[18px] py-3.5 border-b border-whip-border shrink-0">
				<span className="text-xs font-semibold text-whip-muted">Configuration</span>
			</div>

			{/* Config fields */}
			<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
				{/* Workflow */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-whip-faint">
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
							prefix={
								<WorkflowIcon
									size={14}
									style={{ color: isTask ? "var(--color-whip-muted)" : "var(--color-whip-text)" }}
								/>
							}
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
					<span className="text-[11px] font-medium text-whip-faint">Priority</span>
					<PriorityField name="priority" />
				</div>

				{/* Branch Name (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-whip-faint">Branch Name (optional)</span>
						<RHFInput
							name="branchName"
							onChange={onBranchNameEdited}
							placeholder="auto-generated from description"
							prefix={<GitBranch size={13} className="text-whip-faint" />}
						/>
					</div>
				)}

				{/* Base Branch */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-whip-faint">Base Branch</span>
					<RHFSelect
						name="baseRef"
						placeholder="main"
						filterable
						prefix={<GitBranch size={13} className="text-whip-muted" />}
					>
						{branches.map((b) => (
							<SelectOption key={b} value={b} label={b} />
						))}
					</RHFSelect>
				</div>

				{/* Dependencies (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-whip-faint">Relation</span>
						<div className="flex gap-1 rounded-md bg-whip-panel border border-whip-border p-0.5">
							<button
								type="button"
								onClick={() => switchRelationMode("waitsFor")}
								className={classNames(
									"flex-1 rounded py-1 text-[11px] transition-colors",
									relationMode === "waitsFor"
										? "bg-whip-border text-whip-text"
										: "text-whip-faint hover:text-whip-text",
								)}
							>
								Waits for
							</button>
							<button
								type="button"
								onClick={() => switchRelationMode("dependsOn")}
								className={classNames(
									"flex-1 rounded py-1 text-[11px] transition-colors",
									relationMode === "dependsOn"
										? "bg-whip-border text-whip-text"
										: "text-whip-faint hover:text-whip-text",
								)}
							>
								Depends on
							</button>
						</div>
						{relationMode === "waitsFor" ? (
							<>
								<span className="text-[10px] text-whip-faint -mt-1">
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
													className={({ selected }) => (selected ? "bg-whip-border" : "")}
												>
													<div className="flex items-center justify-between w-full gap-2 min-w-0">
														<span className="truncate text-sm">{cDisplay}</span>
														<span
															className={classNames(
																"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																COLUMN_BADGE[c.columnId] ?? "text-whip-muted bg-whip-border",
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
								<span className="text-[10px] text-whip-faint -mt-1">
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
													className={({ selected }) => (selected ? "bg-whip-border" : "")}
												>
													<div className="flex items-center justify-between w-full gap-2 min-w-0">
														<span className="truncate text-sm">{cDisplay}</span>
														<span
															className={classNames(
																"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
																COLUMN_BADGE[c.columnId] ?? "text-whip-muted bg-whip-border",
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
			<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-whip-border shrink-0">
				<label className="flex items-center gap-1.5 cursor-pointer">
					<Switch size="sm" checked={readyForDev} onChange={onToggleReadyForDev} />
					<span className="text-[11px] text-whip-muted">Auto-start</span>
				</label>
				<div className="flex-1" />
				<Button
					variant="filled"
					color="primary"
					onClick={onSubmit}
					disabled={submitDisabled}
					style={isTask ? undefined : { background: "#8b5cf6", borderColor: "#8b5cf6", color: "#ffffff" }}
				>
					<Plus size={14} />
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}
