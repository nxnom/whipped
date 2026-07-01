import { Button, Select, SelectOption } from "@geckoui/geckoui";
import { type TierLevel, TIER_LEVEL_OPTIONS } from "@runtime-contract";
import { X } from "lucide-react";
import { useState } from "react";
import { LEVEL_COLOR } from "@/utils/levelColor";

// Highest capability first.
const LEVELS_DESC = [...TIER_LEVEL_OPTIONS].reverse();

// Shown when a human reopens a card from the comment composer: pick the tier the
// rework should run at, so a stale agent-set level doesn't carry over to new
// scope. Tier is workflow-wide (each agent maps it to its own model); per-slot
// cost mode is edited in the ticket dialog, not here.
export function ReopenPickerDialog({
	currentLevel,
	submitting,
	onConfirm,
	onClose,
}: {
	currentLevel: TierLevel;
	submitting: boolean;
	onConfirm: (level: TierLevel) => void;
	onClose: () => void;
}) {
	const [level, setLevel] = useState<TierLevel>(currentLevel);

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
			<div
				className="flex flex-col gap-4 bg-[#0b0b0b] rounded-xl border border-[#2a2a2a] w-[420px] max-w-[90vw] p-5 shadow-[0_8px_40px_4px_rgba(0,0,0,0.38)]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-3">
					<span className="text-[14px] font-semibold text-[#ededed] flex-1">Reopen — tier for the rework</span>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={18} className="text-[#5f6672]" />
					</button>
				</div>

				<p className="text-[12px] text-[#8a8f98] leading-relaxed">
					Set the tier the rework should run at. It applies to all agents — each picks its own model for that tier. Bump
					it up for big changes; lower it for small ones.
				</p>

				<div className="flex flex-col gap-1.5">
					<span className="text-[11px] font-medium text-[#5f6672] tracking-[0.3px]">Tier</span>
					<Select value={level} onChange={(v) => setLevel(v as TierLevel)}>
						{LEVELS_DESC.map((o) => (
							<SelectOption key={o.value} value={o.value} label={o.label}>
								<span className="flex items-center gap-2">
									<span className="size-2 rounded-full shrink-0" style={{ background: LEVEL_COLOR[o.value] }} />
									{o.label}
								</span>
							</SelectOption>
						))}
					</Select>
				</div>

				<div className="flex items-center justify-end gap-2 pt-1">
					<Button variant="ghost" onClick={onClose} disabled={submitting}>
						Cancel
					</Button>
					<Button onClick={() => onConfirm(level)} disabled={submitting}>
						{submitting ? "Reopening…" : "Reopen"}
					</Button>
				</div>
			</div>
		</div>
	);
}
