import { RHFInput, RHFSelect, SelectOption } from "@geckoui/geckoui";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import { GitBranch, Plus, Workflow as WorkflowIcon } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { COLUMN_BADGE, COLUMN_LABEL } from "./constants";
import { PriorityField } from "./PriorityField";

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
	return (
		<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
			{/* Config header */}
			<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
				<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
			</div>

			{/* Config fields */}
			<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
				{/* Workflow */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#60607a]">
						{isTask ? "Workflow" : "Orchestrator Workflow"}
					</span>
					{activeWorkflows.length === 0 ? (
						<button
							className="text-[11px] text-amber-500 hover:text-amber-400 underline text-left transition-colors"
							onClick={onNoWorkflows}
						>
							No workflows — create one in Settings
						</button>
					) : (
						<RHFSelect
							name="workflowId"
							prefix={<WorkflowIcon size={14} style={{ color: isTask ? "#8888a0" : "#a78bfa" }} />}
						>
							{activeWorkflows.map((w) => (
								<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
							))}
						</RHFSelect>
					)}
				</div>

				{/* Priority */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#60607a]">Priority</span>
					<PriorityField name="priority" />
				</div>

				{/* Branch Name (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-[#60607a]">Branch Name (optional)</span>
						<RHFInput
							name="branchName"
							onChange={onBranchNameEdited}
							placeholder="auto-generated from description"
							prefix={<GitBranch size={13} className="text-[#4a4a5a]" />}
						/>
					</div>
				)}

				{/* Base Branch */}
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium text-[#60607a]">Base Branch</span>
					<RHFSelect
						name="baseRef"
						placeholder="main"
						filterable
						prefix={<GitBranch size={13} className="text-[#8888a0]" />}
					>
						{branches.map((b) => (
							<SelectOption key={b} value={b} label={b} />
						))}
					</RHFSelect>
				</div>

				{/* Dependencies (task only) */}
				{isTask && (
					<div className="flex flex-col gap-2">
						<span className="text-[11px] font-medium text-[#60607a]">Dependencies</span>
						<RHFSelect name="dependsOn" multiple placeholder="None" filterable clearable>
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
											className={({ selected }) => (selected ? "bg-gray-700" : "")}
										>
											<div className="flex items-center justify-between w-full gap-2 min-w-0">
												<span className="truncate text-sm">{cDisplay}</span>
												<span
													className={classNames(
														"text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium",
														COLUMN_BADGE[c.columnId] ?? "text-gray-400 bg-gray-700",
													)}
												>
													{COLUMN_LABEL[c.columnId] ?? c.columnId}
												</span>
											</div>
										</SelectOption>
									);
								})}
						</RHFSelect>
					</div>
				)}
			</div>

			{/* Footer */}
			<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
				<button onClick={onToggleReadyForDev} className="flex items-center gap-1.5">
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
