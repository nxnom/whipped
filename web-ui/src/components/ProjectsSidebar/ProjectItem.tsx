import type { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import type { RuntimeProject } from "@runtime-contract";
import { ConfirmDialog } from "@geckoui/geckoui";
import { Trash2 } from "lucide-react";
import { classNames } from "@/utils/classNames";

interface ProjectItemProps {
	project: RuntimeProject;
	workspaceId: string;
	dp: DraggableProvided;
	snap: DraggableStateSnapshot;
	isActive: boolean;
	indent: boolean;
	onSwitch: (workspaceId: string) => void;
	onRemove: (workspaceId: string) => Promise<void>;
}

export function ProjectItem({
	project,
	workspaceId,
	dp,
	snap,
	isActive,
	indent,
	onSwitch,
	onRemove,
}: ProjectItemProps) {
	return (
		<div
			ref={dp.innerRef}
			{...dp.draggableProps}
			{...dp.dragHandleProps}
			onClick={() => onSwitch(workspaceId)}
			className={classNames(
				"group flex items-center gap-2 h-8 pr-2 my-px mx-1 rounded-md cursor-pointer select-none transition-colors",
				indent ? "pl-10" : "pl-3",
				snap.isDragging ? "opacity-70" : isActive ? "" : "hover:bg-[#1a1a1f]",
			)}
			style={{
				...dp.draggableProps.style,
				background: isActive && !snap.isDragging ? "#7c6aff18" : "transparent",
				borderLeft: isActive && !snap.isDragging ? "2px solid #7c6aff" : "2px solid transparent",
			}}
		>
			{/* Active dot */}
			<div
				className={classNames("w-1.5 h-1.5 rounded-full shrink-0", isActive ? "bg-[#7c6aff]" : "bg-[#2a2a35]")}
				style={isActive ? { boxShadow: "0 0 6px #7c6aff80" } : undefined}
			/>
			<span
				className={classNames(
					"flex-1 min-w-0 truncate text-[12px]",
					isActive ? "text-[#f0f0f5] font-medium" : "text-[#8888a0] font-normal",
				)}
			>
				{project.name}
			</span>
			<span className="shrink-0 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
				<button
					onClick={(e) => {
						e.stopPropagation();
						ConfirmDialog.show({
							title: "Remove project",
							content: `Remove "${project.name}" from Whipped? This will stop all running agents and delete all associated worktrees and data.`,
							confirmButtonLabel: "Remove",
							cancelButtonLabel: "Cancel",
							onConfirm: async ({ dismiss }) => {
								await onRemove(workspaceId);
								dismiss();
							},
						});
					}}
					className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#ef444420] transition-colors text-[#60607a] hover:text-[#ef4444]"
					title="Remove project"
				>
					<Trash2 size={10} />
				</button>
			</span>
		</div>
	);
}
