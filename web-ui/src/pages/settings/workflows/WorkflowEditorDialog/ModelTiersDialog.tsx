import { Button, Checkbox, Select, SelectOption } from "@geckoui/geckoui";
import { EFFORT_OPTIONS, type RuntimeAgentId, TIER_LEVEL_OPTIONS } from "@runtime-contract";
import type { ModelPairForm } from "@runtime-validation/workflow";
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { AgentBinarySelect } from "@/components/AgentBinarySelect";
import { ModelSelect } from "../ModelSelect";

// Full-screen editor for a slot's model tiers, as a table. Order = priority
// (top = highest); the side panel shows a read-only summary and opens this on Edit.
export function ModelTiersDialog({
	pairs,
	defaultBinary,
	onSave,
	onClose,
}: {
	pairs: ModelPairForm[];
	defaultBinary: RuntimeAgentId;
	onSave: (pairs: ModelPairForm[]) => void;
	onClose: () => void;
}) {
	const [draft, setDraft] = useState<ModelPairForm[]>(pairs);

	const patch = (id: string, p: Partial<ModelPairForm>) =>
		setDraft((d) => d.map((row) => (row.id === id ? { ...row, ...p } : row)));

	const addRow = () => {
		setDraft((d) => [
			...d,
			{ id: crypto.randomUUID(), level: "medium", isFree: false, binary: defaultBinary, model: null, effort: null },
		]);
	};

	const deleteRow = (id: string) => setDraft((d) => (d.length <= 1 ? d : d.filter((row) => row.id !== id)));

	const move = (index: number, dir: -1 | 1) => {
		setDraft((d) => {
			const j = index + dir;
			if (j < 0 || j >= d.length) return d;
			const next = [...d];
			const a = next[index];
			const b = next[j];
			if (!a || !b) return d;
			next[index] = b;
			next[j] = a;
			return next;
		});
	};

	const handleSave = () => {
		if (draft.length === 0) return;
		onSave(draft);
		onClose();
	};

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
			<div
				className="flex flex-col overflow-hidden bg-[#141418] rounded-xl border border-[#2a2a35] w-[80vw] max-w-[980px] max-h-[85vh] shadow-[0_8px_40px_4px_rgba(0,0,0,0.38)]"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center gap-3 shrink-0 px-6 py-4 border-b border-[#2a2a35]">
					<span className="text-[15px] font-semibold text-[#f0f0f5] flex-1">Model tiers</span>
					<span className="text-[11px] text-[#60607a]">Order = priority (top first)</span>
					<Button variant="outlined" size="sm" onClick={addRow}>
						<Plus size={13} />
						<span className="text-[12px]">Add tier</span>
					</Button>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={18} className="text-[#60607a]" />
					</button>
				</div>

				{/* Table */}
				<div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
					<div className="grid grid-cols-[44px_120px_120px_1fr_140px_56px_32px] gap-x-3 gap-y-2 items-start">
						{["", "Level", "Agent", "Model", "Effort", "Free", ""].map((h, i) => (
							<span
								key={i}
								className="text-[10px] font-semibold text-[#60607a] tracking-[0.5px] uppercase pb-1 border-b border-[#2a2a35]"
							>
								{h}
							</span>
						))}
						{draft.map((pair, index) => (
							<TierRow
								key={pair.id}
								pair={pair}
								index={index}
								count={draft.length}
								onPatch={(p) => patch(pair.id, p)}
								onMove={move}
								onDelete={() => deleteRow(pair.id)}
							/>
						))}
					</div>
				</div>

				{/* Footer */}
				<div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-[#2a2a35]">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleSave}>Save tiers</Button>
				</div>
			</div>
		</div>
	);
}

function TierRow({
	pair,
	index,
	count,
	onPatch,
	onMove,
	onDelete,
}: {
	pair: ModelPairForm;
	index: number;
	count: number;
	onPatch: (p: Partial<ModelPairForm>) => void;
	onMove: (index: number, dir: -1 | 1) => void;
	onDelete: () => void;
}) {
	return (
		<>
			<div className="flex flex-col items-center h-9 justify-center">
				<button
					type="button"
					onClick={() => onMove(index, -1)}
					disabled={index === 0}
					title="Move up"
					className="hover:opacity-80 transition-opacity disabled:opacity-25"
				>
					<ChevronUp size={13} className="text-[#8888a0]" />
				</button>
				<button
					type="button"
					onClick={() => onMove(index, 1)}
					disabled={index === count - 1}
					title="Move down"
					className="hover:opacity-80 transition-opacity disabled:opacity-25"
				>
					<ChevronDown size={13} className="text-[#8888a0]" />
				</button>
			</div>
			<Select
				floatingStrategy="fixed"
				value={pair.level}
				onChange={(v) => onPatch({ level: v as ModelPairForm["level"] })}
				menuClassName="w-fit"
			>
				{TIER_LEVEL_OPTIONS.map((o) => (
					<SelectOption key={o.value} value={o.value} label={o.label} />
				))}
			</Select>
			<AgentBinarySelect
				floatingStrategy="fixed"
				value={pair.binary}
				onChange={(v) => onPatch({ binary: v, model: null })}
				menuClassName="w-fit"
			/>
			<ModelSelect
				key={pair.binary}
				agentId={pair.binary}
				floatingStrategy="fixed"
				value={pair.model ?? ""}
				onChange={(v) => onPatch({ model: v || null })}
				menuClassName="w-fit"
			/>
			<Select
				floatingStrategy="fixed"
				value={pair.effort ?? ""}
				onChange={(v) => onPatch({ effort: (v as ModelPairForm["effort"]) || null })}
				menuClassName="w-fit"
			>
				<SelectOption value="" label="Default" />
				{EFFORT_OPTIONS.map((o) => (
					<SelectOption key={o.value} value={o.value} label={o.label} />
				))}
			</Select>
			<div className="flex items-center justify-center h-9">
				<Checkbox checked={pair.isFree} onChange={(e) => onPatch({ isFree: e.target.checked })} />
			</div>
			<button
				type="button"
				onClick={onDelete}
				disabled={count <= 1}
				title="Delete tier"
				className="flex items-center justify-center h-9 hover:opacity-80 transition-opacity disabled:opacity-30"
			>
				<Trash2 size={14} className="text-[#ef4444]" />
			</button>
		</>
	);
}
