import type { DraggableProvided } from "@hello-pangea/dnd";

interface EmptyFolderSlotProps {
	dp: DraggableProvided;
}

export function EmptyFolderSlot({ dp }: EmptyFolderSlotProps) {
	return (
		<div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} className="pl-10 pr-2.5 py-[3px]">
			<div className="h-7 border border-dashed border-whip-border rounded-md flex items-center pl-2.5 gap-1.5">
				<div className="w-1 h-1 rounded-full bg-whip-border" />
				<span className="text-[10px] text-whip-faint">Drop project here</span>
			</div>
		</div>
	);
}
