import { Menu, MenuItem, MenuTrigger } from "@geckoui/geckoui";
import type { WorkflowSlotForm } from "@runtime-validation/workflow";
import { ArrowRight, Plus } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { slotTypeColor } from "./helpers";

export function SlotPipeline({
	sortedSlots,
	selectedSlotId,
	forStory,
	hasPlan,
	onSwitchSlot,
	onAddSlot,
}: {
	sortedSlots: WorkflowSlotForm[];
	selectedSlotId: string;
	forStory: boolean;
	hasPlan: boolean;
	onSwitchSlot: (slotId: string) => void;
	onAddSlot: (type: "review" | "plan" | "orch") => void;
}) {
	return (
		<div className="shrink-0 px-6 py-4 border-b border-whip-border">
			{/* Pipeline header */}
			<div className="flex items-center gap-2 mb-3">
				<span className="text-[10px] font-semibold shrink-0 text-whip-faint tracking-[1px]">PIPELINE</span>
				<div className="flex-1 h-px bg-whip-panel" />
				<Menu placement="bottom-end">
					<MenuTrigger>
						{({ toggleMenu }) => (
							<button
								onClick={toggleMenu}
								className="flex items-center gap-1 hover:opacity-80 transition-opacity bg-transparent border border-whip-border rounded-[4px] px-2 py-[3px]"
							>
								<Plus size={11} className="text-whip-faint" />
								<span className="text-[10px] text-whip-faint">Add Slot</span>
							</button>
						)}
					</MenuTrigger>
					{!forStory && !hasPlan && <MenuItem onClick={() => onAddSlot("plan")}>Plan</MenuItem>}
					{!forStory && <MenuItem onClick={() => onAddSlot("review")}>Review</MenuItem>}
					{forStory && <MenuItem onClick={() => onAddSlot("orch")}>Orch Agent</MenuItem>}
				</Menu>
			</div>
			{/* Slot pills */}
			<div className="flex items-center flex-wrap">
				{sortedSlots.map((slot, idx) => {
					const isSelected = slot.id === selectedSlotId;
					const isDisabled = !slot.enabled;
					const color = slotTypeColor(slot.type);
					// A one-shot plan (rerun off) runs once and detaches from the loop — keep
					// the connector's spacing but hide the arrow so the pills don't crowd.
					const prev = sortedSlots[idx - 1];
					const showArrow = idx > 0 && !(prev?.type === "plan" && !prev.rerun);
					return (
						<div key={slot.id} className="flex items-center">
							{idx > 0 && (
								<div className="flex items-center justify-center w-8">
									<ArrowRight size={14} className={showArrow ? "text-whip-border" : "text-transparent"} />
								</div>
							)}
							<button
								onClick={() => onSwitchSlot(slot.id)}
								className={classNames(
									"flex items-center transition-colors rounded-lg px-3.5 py-2 gap-2",
									isSelected
										? "bg-whip-accent/15 border-2 border-whip-accent"
										: "bg-whip-panel border border-whip-border",
									isDisabled ? "opacity-40" : "",
								)}
							>
								<div
									className="flex items-center justify-center shrink-0 w-5 h-5 rounded-[10px]"
									style={{
										background: isDisabled ? "color-mix(in srgb, var(--whip-border) 15%, transparent)" : `${color}25`,
									}}
								>
									<span className="text-[9px] font-bold" style={{ color: isDisabled ? "var(--whip-faint)" : color }}>
										{idx + 1}
									</span>
								</div>
								<span
									className={classNames(
										"text-[12px]",
										isSelected ? "text-whip-text font-semibold" : isDisabled ? "text-whip-faint" : "text-whip-muted",
										isDisabled ? "line-through" : "",
									)}
								>
									{slot.name}
								</span>
							</button>
						</div>
					);
				})}
				{sortedSlots.length === 0 && <span className="text-[12px] text-whip-faint">No slots — add one above</span>}
			</div>
		</div>
	);
}
