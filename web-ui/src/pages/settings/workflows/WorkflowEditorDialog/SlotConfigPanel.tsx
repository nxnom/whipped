import { Button, Input, RHFSwitch, Select, SelectOption, Switch } from "@geckoui/geckoui";
import {
	PAIR_SELECTION_MODE_OPTIONS,
	type PairSelectionMode,
	type RuntimeAgentId,
	type SlotTool,
	TIER_LEVEL_OPTIONS,
} from "@runtime-contract";
import type { ModelPairForm, WorkflowSlotForm } from "@runtime-validation/workflow";
import { Check, Pencil, Trash2, Type } from "lucide-react";
import { useState } from "react";
import { ModelTiersDialog } from "./ModelTiersDialog";

function ToggleRow({
	title,
	description,
	checked,
	onChange,
}: {
	title: string;
	description: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center gap-3">
			<div className="flex flex-col">
				<span className="text-[13px] text-whip-text">{title}</span>
				<span className="text-[11px] text-whip-faint">{description}</span>
			</div>
			<div className="flex-1" />
			<Switch checked={checked} onChange={onChange} />
		</div>
	);
}

const levelLabel = (level: ModelPairForm["level"]) => TIER_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level;

export function SlotConfigPanel({
	selectedSlot,
	selectedIndex,
	nameEditable,
	isNew,
	defaultBinary,
	updateSlot,
	onDeleteSlot,
	onSave,
}: {
	selectedSlot: WorkflowSlotForm | undefined;
	selectedIndex: number;
	nameEditable: boolean;
	isNew: boolean;
	defaultBinary: RuntimeAgentId;
	updateSlot: (patch: Partial<WorkflowSlotForm>) => void;
	onDeleteSlot: () => void;
	onSave: () => void;
}) {
	const [tiersOpen, setTiersOpen] = useState(false);

	const toggleBrowser = (on: boolean) => {
		const tools = (selectedSlot?.tools ?? []).filter((t) => t !== "browser");
		updateSlot({ tools: on ? ([...tools, "browser"] as SlotTool[]) : tools });
	};

	return (
		<div className="flex flex-col shrink-0 overflow-hidden w-[340px] bg-whip-panel border-l border-whip-border">
			{/* Header */}
			<div className="shrink-0 px-5 py-4 border-b border-whip-border">
				<span className="text-[13px] font-semibold text-whip-text">Slot Configuration</span>
			</div>
			{selectedSlot ? (
				<>
					{/* Scrollable middle */}
					<div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 gap-4">
						{/* Name */}
						<div className="flex flex-col gap-[5px]">
							<span className="text-[11px] font-medium text-whip-faint tracking-[0.3px]">Name</span>
							<Input
								prefix={<Type size={13} className="text-whip-faint" />}
								value={selectedSlot.name}
								onChange={(e) => updateSlot({ name: e.target.value })}
								readOnly={!nameEditable}
							/>
						</div>

						{/* Model tiers — read-only summary; Edit opens the table dialog */}
						<div className="flex flex-col gap-[5px]">
							<div className="flex items-center">
								<span className="text-[11px] font-medium text-whip-faint tracking-[0.3px]">Model tiers</span>
								<div className="flex-1" />
								<button
									type="button"
									onClick={() => setTiersOpen(true)}
									className="flex items-center gap-1 hover:opacity-80 transition-opacity bg-transparent border border-whip-border rounded-[4px] px-2 py-[3px]"
								>
									<Pencil size={11} className="text-whip-faint" />
									<span className="text-[10px] text-whip-faint">Edit</span>
								</button>
							</div>
							<div className="flex flex-col gap-1.5">
								{selectedSlot.pairs.map((p) => (
									<div
										key={p.id}
										className="flex items-center gap-2 bg-whip-panel border border-whip-border rounded-md px-3 py-2"
									>
										<span className="text-[12px] text-whip-text shrink-0">{levelLabel(p.level)}</span>
										<span className="text-[11px] text-whip-faint truncate">
											{p.binary}
											{p.model ? `/${p.model}` : ""}
											{p.effort ? ` · ${p.effort}` : ""}
										</span>
										<div className="flex-1" />
										{p.isFree && (
											<span className="shrink-0 text-[9px] font-medium text-[#22c55e] bg-[#22c55e15] rounded px-1.5 py-[1px]">
												Free
											</span>
										)}
									</div>
								))}
							</div>
						</div>

						{/* Selection mode */}
						<div className="flex flex-col gap-[5px]">
							<span className="text-[11px] font-medium text-whip-faint tracking-[0.3px]">Selection mode</span>
							<Select value={selectedSlot.mode} onChange={(v) => updateSlot({ mode: v as PairSelectionMode })}>
								{PAIR_SELECTION_MODE_OPTIONS.map((o) => (
									<SelectOption key={o.value} value={o.value} label={o.label} />
								))}
							</Select>
						</div>

						{selectedSlot.type === "review" && (
							<ToggleRow
								title="Browser tool"
								description="Playwright control to exercise a running UI"
								checked={selectedSlot.tools.includes("browser")}
								onChange={toggleBrowser}
							/>
						)}

						{selectedSlot.type === "review" && (
							<ToggleRow
								title="Can adjust tier"
								description="Let this reviewer right-size the level on reopen (all agents)"
								checked={selectedSlot.canAdjustLevel}
								onChange={(c) => updateSlot({ canAdjustLevel: c })}
							/>
						)}

						{selectedSlot.type === "plan" && (
							<ToggleRow
								title="Re-run"
								description="Re-plan even if the card already has a plan"
								checked={selectedSlot.rerun}
								onChange={(c) => updateSlot({ rerun: c })}
							/>
						)}

						{selectedSlot.type !== "dev" && (
							<>
								<div className="h-px bg-whip-border shrink-0" />
								<div className="flex items-center">
									<span className="text-[13px] text-whip-text">Enabled</span>
									<div className="flex-1" />
									{selectedIndex >= 0 && <RHFSwitch name={`slots.${selectedIndex}.enabled`} />}
								</div>
							</>
						)}
					</div>

					{/* Fixed footer */}
					<div className="shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-whip-border">
						{selectedSlot.type !== "dev" && (
							<Button variant="outlined" onClick={onDeleteSlot} className="!border-[#ff3b4d40] !text-[#ff3b4d]">
								<Trash2 size={13} />
								<span className="text-[12px]">Delete</span>
							</Button>
						)}
						<Button onClick={onSave}>
							<Check size={13} />
							<span className="text-[12px] font-medium">{isNew ? "Create" : "Save"}</span>
						</Button>
					</div>

					{tiersOpen && (
						<ModelTiersDialog
							pairs={selectedSlot.pairs}
							defaultBinary={defaultBinary}
							onSave={(pairs: ModelPairForm[]) => updateSlot({ pairs })}
							onClose={() => setTiersOpen(false)}
						/>
					)}
				</>
			) : (
				<div className="flex-1 flex items-center justify-center text-[12px] text-whip-faint">
					Select a slot to configure
				</div>
			)}
		</div>
	);
}
