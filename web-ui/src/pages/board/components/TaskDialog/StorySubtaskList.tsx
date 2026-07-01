import { Button } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import { GripVertical, ListTree, Plus, Sparkles, X } from "lucide-react";
import { PRIORITY_OPTIONS } from "./constants";
import type { SubtaskDraft } from "./types";

interface StorySubtaskListProps {
	subtaskDrafts: SubtaskDraft[];
	allCards: Record<string, RuntimeBoardCard>;
	onAdd: () => void;
	onEdit: (tempId: string) => void;
	onRemove: (tempId: string) => void;
}

export function StorySubtaskList({ subtaskDrafts, allCards, onAdd, onEdit, onRemove }: StorySubtaskListProps) {
	return (
		<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
			<div className="h-px bg-[#2a2a2a] shrink-0 my-2" />
			{/* Subtasks header */}
			<div className="flex items-center gap-2 shrink-0 mb-2">
				<ListTree size={14} className="text-[#8a8f98]" />
				<span className="text-xs font-semibold text-[#8a8f98]">Subtasks</span>
				{subtaskDrafts.length > 0 && (
					<div className="bg-[#2a2a2a] rounded-full px-1.5 py-0.5">
						<span className="text-[10px] text-[#5f6672]">{subtaskDrafts.length}</span>
					</div>
				)}
				<div className="flex-1" />
				<Button
					variant="outlined"
					size="xs"
					style={{ background: "#8b5cf615", borderColor: "#8b5cf630", color: "#8b5cf6" }}
				>
					<Sparkles size={12} />
					Generate
				</Button>
				<Button variant="outlined" size="xs" onClick={onAdd}>
					<Plus size={12} />
					Add
				</Button>
			</div>
			{/* Subtask list */}
			<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
				{subtaskDrafts.length === 0 && (
					<div
						onClick={onAdd}
						className="border border-dashed border-[#2a2a2a] rounded-lg p-5 flex flex-col items-center gap-2 cursor-pointer hover:border-[#3a3a3a] hover:bg-white/[0.02] transition-colors"
					>
						<Plus size={16} className="text-[#5f6672]" />
						<p className="text-xs text-[#5f6672]">At least one subtask is required</p>
					</div>
				)}
				{subtaskDrafts.map((subtask, i) => {
					const depLabels = (subtask.dependsOn ? [subtask.dependsOn] : []).map((dep) => {
						const draft = subtaskDrafts.find((s) => s.tempId === dep);
						return draft ? `#${subtaskDrafts.indexOf(draft) + 1}` : (allCards[dep]?.description?.split("\n")[0] ?? dep);
					});
					const priorityOpt = PRIORITY_OPTIONS.find((p) => p.value === subtask.priority);
					return (
						<button
							key={subtask.tempId}
							onClick={() => onEdit(subtask.tempId)}
							className="flex items-center gap-2.5 bg-[#111111] border border-[#2a2a2a] rounded-md px-2.5 py-2 text-left hover:border-[#3a3a3a] transition-colors group w-full"
						>
							<GripVertical size={12} className="text-[#2a2a2a] shrink-0" />
							<span className="text-[10px] text-[#5f6672] font-mono shrink-0 w-4">{i + 1}</span>
							<span className="flex-1 min-w-0 text-xs text-[#ededed] truncate">
								{subtask.description?.split("\n")[0] ?? subtask.tempId}
							</span>
							{priorityOpt && (
								<span
									className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full"
									style={{ color: priorityOpt.text, background: priorityOpt.bg }}
								>
									{priorityOpt.label}
								</span>
							)}
							{depLabels.length > 0 && (
								<span className="shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full text-[#3b82f6] bg-[#3b82f610] border border-[#3b82f620]">
									after {depLabels.join(" ")}
								</span>
							)}
							<span
								onClick={(e) => {
									e.stopPropagation();
									onRemove(subtask.tempId);
								}}
								className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#5f6672] hover:text-[#ff3b4d] p-0.5"
							>
								<X size={12} />
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
