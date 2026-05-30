import type { DraggableProvided } from "@hello-pangea/dnd";

interface EmptyFolderSlotProps {
	dp: DraggableProvided;
}

export function EmptyFolderSlot({ dp }: EmptyFolderSlotProps) {
	return (
		<div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} className="pl-10 pr-2.5 py-[3px]">
			<div className="h-7 border border-dashed border-[#2a2a35] rounded-md flex items-center pl-2.5 gap-1.5">
				<div className="w-1 h-1 rounded-full bg-[#2a2a35]" />
				<span className="text-[10px] text-[#3a3a45]">Drop project here</span>
			</div>
		</div>
	);
}
