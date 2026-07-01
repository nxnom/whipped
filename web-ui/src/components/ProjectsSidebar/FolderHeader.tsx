import type { DraggableProvided, DraggableStateSnapshot } from "@hello-pangea/dnd";
import type { ProjectsLayout } from "@runtime-contract";
import { ChevronDown, ChevronRight, Folder, Pencil, Trash2 } from "lucide-react";
import type { RefObject } from "react";
import { classNames } from "@/utils/classNames";

interface FolderHeaderProps {
	folderId: string;
	folder: NonNullable<ProjectsLayout["folders"][string]>;
	dp: DraggableProvided;
	snap: DraggableStateSnapshot;
	expanded: boolean;
	hovered: boolean;
	editing: boolean;
	editName: string;
	editRef: RefObject<HTMLInputElement>;
	onToggleCollapse: (id: string) => void;
	onStartRename: (id: string) => void;
	onDeleteFolder: (id: string) => void;
	onEditNameChange: (value: string) => void;
	onCommitRename: () => void;
	onCancelRename: () => void;
}

export function FolderHeader({
	folderId,
	folder,
	dp,
	snap,
	expanded,
	hovered,
	editing,
	editName,
	editRef,
	onToggleCollapse,
	onStartRename,
	onDeleteFolder,
	onEditNameChange,
	onCommitRename,
	onCancelRename,
}: FolderHeaderProps) {
	return (
		<div
			ref={dp.innerRef}
			{...dp.draggableProps}
			{...dp.dragHandleProps}
			onClick={() => onToggleCollapse(folderId)}
			className="group flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md my-px mx-1 cursor-pointer select-none transition-colors"
			style={{
				...dp.draggableProps.style,
				background: snap.isDragging ? "#161616" : hovered ? "#ffffff12" : "transparent",
			}}
		>
			{/* Chevron */}
			<div className="shrink-0 flex items-center justify-center w-3.5 text-[#5f6672]">
				{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
			</div>

			{/* Folder icon */}
			<Folder size={13} className={classNames("shrink-0", hovered ? "text-[#ededed]" : "text-[#5f6672]")} />

			{/* Name */}
			{editing ? (
				<input
					ref={editRef}
					value={editName}
					onChange={(e) => onEditNameChange(e.target.value)}
					onBlur={onCommitRename}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key === "Enter") onCommitRename();
						if (e.key === "Escape") onCancelRename();
					}}
					className="flex-1 min-w-0 outline-none text-[11px] rounded px-1 bg-[#111111] border border-[#2a2a2a] text-[#ededed]"
				/>
			) : (
				<span
					className={classNames(
						"flex-1 min-w-0 truncate text-[11px] font-medium tracking-[0.2px]",
						hovered ? "text-[#ededed]" : "text-[#8a8f98]",
					)}
					onDoubleClick={(e) => {
						e.stopPropagation();
						onStartRename(folderId);
					}}
				>
					{folder.name}
				</span>
			)}

			{/* Actions */}
			<span className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
				<button
					onClick={(e) => {
						e.stopPropagation();
						onStartRename(folderId);
					}}
					className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#2a2a2a] transition-colors text-[#5f6672]"
					title="Rename"
				>
					<Pencil size={10} />
				</button>
				<button
					onClick={(e) => {
						e.stopPropagation();
						onDeleteFolder(folderId);
					}}
					className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#ff3b4d20] transition-colors text-[#5f6672]"
					title="Delete"
				>
					<Trash2 size={10} />
				</button>
			</span>
		</div>
	);
}
