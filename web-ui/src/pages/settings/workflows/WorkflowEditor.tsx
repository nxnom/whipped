import { ConfirmDialog, Switch } from "@geckoui/geckoui";
import {
	DragDropContext,
	Draggable,
	type DraggableProvidedDragHandleProps,
	Droppable,
	type DropResult,
} from "@hello-pangea/dnd";
import { EMPTY_INLINE_PROMPT, type RuntimeAgentId, type Workflow, type WorkflowSlot } from "@runtime-contract";
import { GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { classNames } from "@/utils/classNames";

export function WorkflowEditor({
	workflow,
	defaultBinary,
	onUpdate,
	onEditSlot,
	onAddCustom,
	onAddOrch,
}: {
	workflow: Workflow;
	defaultBinary: RuntimeAgentId;
	onUpdate: (wf: Workflow) => void;
	onEditSlot: (slot: WorkflowSlot) => void;
	onAddCustom: () => void;
	onAddOrch: () => void;
}) {
	const devSlot = workflow.slots.find((s) => s.type === "dev");
	const nonDevSlots = workflow.slots.filter((s) => s.type !== "dev").sort((a, b) => a.order - b.order);
	const hasCR = workflow.slots.some((s) => s.type === "code_review");
	const hasQA = workflow.slots.some((s) => s.type === "qa");

	const handleDragEnd = (result: DropResult) => {
		if (!result.destination || result.destination.index === result.source.index) return;
		const reordered = [...nonDevSlots];
		const [moved] = reordered.splice(result.source.index, 1);
		if (!moved) return;
		reordered.splice(result.destination.index, 0, moved);
		const devSlots = workflow.slots.filter((s) => s.type === "dev");
		onUpdate({ ...workflow, slots: [...devSlots, ...reordered.map((s, i) => ({ ...s, order: i + 1 }))] });
	};

	const handleToggle = (slotId: string, enabled: boolean) => {
		onUpdate({ ...workflow, slots: workflow.slots.map((s) => (s.id === slotId ? { ...s, enabled } : s)) });
	};

	const handleRemove = (slotId: string) => {
		const slot = workflow.slots.find((s) => s.id === slotId);
		ConfirmDialog.show({
			title: "Remove agent",
			content: `Remove "${slot?.name ?? "this agent"}" from the workflow?`,
			confirmButtonLabel: "Remove",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				const remaining = workflow.slots.filter((s) => s.id !== slotId);
				const devs = remaining.filter((s) => s.type === "dev");
				const others = remaining.filter((s) => s.type !== "dev").map((s, i) => ({ ...s, order: i + 1 }));
				onUpdate({ ...workflow, slots: [...devs, ...others] });
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const addBuiltinSlot = (type: "code_review" | "qa") => {
		const maxOrder = workflow.slots.reduce((m, s) => Math.max(m, s.order), 0);
		const defaults = {
			code_review: { id: "code_review", name: "Code Review", enabled: true },
			qa: { id: "qa", name: "QA", enabled: false },
		};
		const d = defaults[type];
		const newSlot: WorkflowSlot = {
			...d,
			type,
			agentBinary: defaultBinary,
			order: maxOrder + 1,
			prompt: EMPTY_INLINE_PROMPT,
		};
		onUpdate({ ...workflow, slots: [...workflow.slots, newSlot] });
	};

	// Story workflows: orch-only editor
	if (workflow.forStory) {
		const orchSlots = workflow.slots.filter((s) => s.type === "orch").sort((a, b) => a.order - b.order);
		const handleOrchDragEnd = (result: DropResult) => {
			if (!result.destination || result.destination.index === result.source.index) return;
			const reordered = [...orchSlots];
			const [moved] = reordered.splice(result.source.index, 1);
			if (!moved) return;
			reordered.splice(result.destination.index, 0, moved);
			onUpdate({ ...workflow, slots: reordered.map((s, i) => ({ ...s, order: i })) });
		};
		return (
			<div className="border border-purple-900/50 rounded-xl p-4 space-y-3">
				<DragDropContext onDragEnd={handleOrchDragEnd}>
					<Droppable droppableId={`wf-story-${workflow.id}`}>
						{(provided) => (
							<div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
								{orchSlots.map((slot, idx) => (
									<Draggable key={slot.id} draggableId={`${workflow.id}-${slot.id}`} index={idx}>
										{(drag, snapshot) => (
											<div
												ref={drag.innerRef}
												{...drag.draggableProps}
												className={classNames(
													"rounded-xl border transition-shadow",
													snapshot.isDragging ? "border-purple-600 shadow-lg" : "border-purple-900/40",
												)}
											>
												<SlotCard
													slot={slot}
													dragHandleProps={drag.dragHandleProps ?? undefined}
													onToggle={(v) => handleToggle(slot.id, v)}
													onRemove={() => handleRemove(slot.id)}
													onEdit={() => onEditSlot(slot)}
												/>
											</div>
										)}
									</Draggable>
								))}
								{provided.placeholder}
							</div>
						)}
					</Droppable>
				</DragDropContext>
				<div className="pt-1 border-t border-purple-900/30">
					<button
						onClick={onAddOrch}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-400 transition-colors py-1"
					>
						<Plus size={11} /> Orch Agent
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="border border-gray-800 rounded-xl p-4 space-y-3">
			{/* Dev slot — always first, fixed position */}
			{devSlot && <SlotCard slot={devSlot} isFixed onEdit={() => onEditSlot(devSlot)} />}

			{/* Non-dev slots — draggable */}
			<DragDropContext onDragEnd={handleDragEnd}>
				<Droppable droppableId={`wf-${workflow.id}`}>
					{(provided) => (
						<div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
							{nonDevSlots.map((slot, idx) => (
								<Draggable key={slot.id} draggableId={`${workflow.id}-${slot.id}`} index={idx}>
									{(drag, snapshot) => (
										<div
											ref={drag.innerRef}
											{...drag.draggableProps}
											className={classNames(
												"rounded-xl border transition-shadow",
												snapshot.isDragging ? "border-gray-600 shadow-lg" : "border-gray-700",
											)}
										>
											<SlotCard
												slot={slot}
												dragHandleProps={drag.dragHandleProps ?? undefined}
												onToggle={(v) => handleToggle(slot.id, v)}
												onRemove={() => handleRemove(slot.id)}
												onEdit={() => onEditSlot(slot)}
											/>
										</div>
									)}
								</Draggable>
							))}
							{provided.placeholder}
						</div>
					)}
				</Droppable>
			</DragDropContext>

			{/* Add agent buttons */}
			<div className="flex gap-2 flex-wrap pt-1 border-t border-gray-800">
				{!hasCR && (
					<button
						onClick={() => addBuiltinSlot("code_review")}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
					>
						<Plus size={11} /> Code Review
					</button>
				)}
				{!hasQA && (
					<button
						onClick={() => addBuiltinSlot("qa")}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
					>
						<Plus size={11} /> QA
					</button>
				)}
				<button
					onClick={onAddCustom}
					className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
				>
					<Plus size={11} /> Custom Agent
				</button>
			</div>
		</div>
	);
}

function SlotCard({
	slot,
	isFixed,
	dragHandleProps,
	onToggle,
	onRemove,
	onEdit,
}: {
	slot: WorkflowSlot;
	isFixed?: boolean;
	dragHandleProps?: DraggableProvidedDragHandleProps;
	onToggle?: (v: boolean) => void;
	onRemove?: () => void;
	onEdit: () => void;
}) {
	return (
		<div className="bg-gray-900 rounded-xl px-3 py-2.5 flex gap-2">
			<div className="flex items-start pt-0.5 shrink-0">
				{dragHandleProps ? (
					<span
						{...(dragHandleProps as React.HTMLAttributes<HTMLSpanElement>)}
						className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing"
					>
						<GripVertical size={13} />
					</span>
				) : (
					<span className="w-[13px]" />
				)}
			</div>
			<div className="flex-1 min-w-0 space-y-1">
				{/* Row 1: name + actions */}
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5 min-w-0">
						<span className="text-sm text-gray-200 truncate">{slot.name}</span>
						{slot.type !== "custom" && (
							<span className="text-xs text-gray-600 shrink-0">{slot.type.replace("_", " ")}</span>
						)}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{!isFixed && onToggle && <Switch checked={slot.enabled} onChange={onToggle} size="sm" />}
						<button onClick={onEdit} className="text-gray-500 hover:text-gray-200 transition-colors">
							<Settings2 size={13} />
						</button>
					</div>
				</div>
				{/* Row 2: badges + delete */}
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">
						{slot.agentBinary}
					</span>
					{slot.model && (
						<span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
							{slot.model}
						</span>
					)}
					{slot.effort && (
						<span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono">
							{slot.effort}
						</span>
					)}
					{slot.prompt &&
						(slot.prompt.source === "inline"
							? slot.prompt.text.length > 0
							: slot.prompt.path.length > 0) && (
							<span className="text-[10px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">
								{slot.prompt.source === "file" ? "prompt file" : "custom prompt"}
							</span>
						)}
					{onRemove && (
						<button onClick={onRemove} className="ml-auto text-gray-600 hover:text-red-400 transition-colors">
							<Trash2 size={13} />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
