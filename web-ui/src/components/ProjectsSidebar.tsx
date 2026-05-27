import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import type { ProjectsLayout, RuntimeProject } from "@runtime-contract";
import { ConfirmDialog } from "@geckoui/geckoui";
import { ChevronDown, ChevronRight, Folder, Pencil, Trash2 } from "lucide-react";
import React, { useEffect, useImperativeHandle, useRef, useState, useCallback } from "react";
import { trpc } from "@/runtime/trpc-client";
import { classNames } from "@/utils/classNames";

function genId() {
	return Math.random().toString(36).slice(2, 10);
}

// ── Flat-list helpers ─────────────────────────────────────────────────────────

type FlatItem =
	| { kind: "folder-header"; folderId: string }
	| { kind: "project"; workspaceId: string; folderId: string | null }
	| { kind: "empty-folder-slot"; folderId: string };

/** Build the ordered flat array including folder headers. */
function buildFlat(layout: ProjectsLayout, expandAll: boolean, isDragging = false): FlatItem[] {
	const flat: FlatItem[] = [];
	for (const item of layout.topLevel) {
		if (item.type === "folder") {
			flat.push({ kind: "folder-header", folderId: item.id });
			const expanded = expandAll || !layout.folders[item.id]?.collapsed;
			if (expanded) {
				const projectIds = layout.folders[item.id]?.projectIds ?? [];
				for (const wsId of projectIds) {
					flat.push({ kind: "project", workspaceId: wsId, folderId: item.id });
				}
				if (isDragging && projectIds.length === 0) {
					flat.push({ kind: "empty-folder-slot", folderId: item.id });
				}
			}
		} else {
			flat.push({ kind: "project", workspaceId: item.workspaceId, folderId: null });
		}
	}
	return flat;
}

/** Reconstruct ProjectsLayout from a re-ordered flat array. */
function flatToLayout(flat: FlatItem[], existing: ProjectsLayout): ProjectsLayout {
	const topLevel: ProjectsLayout["topLevel"] = [];
	const folders: ProjectsLayout["folders"] = Object.fromEntries(
		Object.entries(existing.folders).map(([k, v]) => [k, { ...v, projectIds: [] }]),
	);
	const seen = new Set<string>();
	for (const item of flat) {
		if (item.kind === "empty-folder-slot") continue;
		if (item.kind === "folder-header") {
			if (!seen.has(item.folderId)) {
				seen.add(item.folderId);
				topLevel.push({ type: "folder", id: item.folderId });
			}
		} else if (item.folderId !== null) {
			folders[item.folderId]?.projectIds.push(item.workspaceId);
		} else {
			topLevel.push({ type: "project", workspaceId: item.workspaceId });
		}
	}
	return { ...existing, topLevel, folders };
}

/** What folder does a drop at `destIndex` land in (after source removal)?
 *
 * Primary: look at item AFTER destination (forward-look is unambiguous for "between folders").
 * Fallback at end-of-list: look at item BEFORE destination so you can still append inside a folder.
 */
function folderAtDest(flat: FlatItem[], destIndex: number): string | null {
	const after = flat[destIndex];

	if (!after) {
		// End of list — inherit from previous item (lets users drop at end of a folder)
		const prev = flat[destIndex - 1];
		if (!prev || prev.kind === "folder-header") return null;
		if (prev.kind === "empty-folder-slot") return prev.folderId;
		return (prev as Extract<FlatItem, { kind: "project" }>).folderId;
	}

	if (after.kind === "folder-header") return after.folderId; // dropping on folder header → into that folder
	if (after.kind === "empty-folder-slot") return after.folderId;
	return (after as Extract<FlatItem, { kind: "project" }>).folderId;
}

/** Sync layout: add new projects, remove stale refs. */
function syncLayout(layout: ProjectsLayout, projects: RuntimeProject[]): ProjectsLayout {
	const known = new Set(projects.map((p) => p.workspaceId));
	const topLevel = layout.topLevel.filter((i) => i.type === "folder" || known.has(i.workspaceId));
	const folders = Object.fromEntries(
		Object.entries(layout.folders).map(([id, f]) => [
			id,
			{ ...f, projectIds: f.projectIds.filter((id) => known.has(id)) },
		]),
	);
	const inLayout = new Set<string>();
	for (const i of topLevel) {
		if (i.type === "project") inLayout.add(i.workspaceId);
	}
	for (const f of Object.values(folders)) {
		for (const id of f.projectIds) inLayout.add(id);
	}
	const newItems = projects
		.filter((p) => !inLayout.has(p.workspaceId))
		.map((p) => ({ type: "project" as const, workspaceId: p.workspaceId }));
	return { ...layout, topLevel: [...topLevel, ...newItems], folders };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
	projects: RuntimeProject[];
	activeWorkspaceId: string | null;
	onSwitch: (workspaceId: string) => void;
	onRemove: (workspaceId: string) => Promise<void>;
}

export interface ProjectsSidebarHandle {
	addFolder: () => void;
}

export const ProjectsSidebar = React.forwardRef<ProjectsSidebarHandle, Props>(function ProjectsSidebar(
	{ projects, activeWorkspaceId, onSwitch, onRemove },
	ref,
) {
	const [layout, setLayout] = useState<ProjectsLayout>({ version: 1, topLevel: [], folders: {} });
	const [isDragging, setIsDragging] = useState(false);
	const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const editRef = useRef<HTMLInputElement>(null);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		trpc.projects.getLayout
			.query()
			.then((saved) => setLayout((prev) => syncLayout(saved ?? prev, projects)))
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		setLayout((prev) => syncLayout(prev, projects));
	}, [projects]);

	const persist = (next: ProjectsLayout) => {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			trpc.projects.saveLayout.mutate(next).catch(() => {});
		}, 300);
	};

	const update = (next: ProjectsLayout) => {
		setLayout(next);
		persist(next);
	};

	// ── Folder actions ────────────────────────────────────────────────────────

	const addFolder = () => {
		const id = genId();
		const next: ProjectsLayout = {
			...layout,
			topLevel: [...layout.topLevel, { type: "folder", id }],
			folders: { ...layout.folders, [id]: { id, name: "New Folder", collapsed: false, projectIds: [] } },
		};
		update(next);
		setEditingId(id);
		setEditName("New Folder");
		setTimeout(() => {
			editRef.current?.focus();
			editRef.current?.select();
		}, 50);
	};

	useImperativeHandle(ref, () => ({ addFolder }));

	const startRename = (id: string) => {
		setEditingId(id);
		setEditName(layout.folders[id]?.name ?? "");
		setTimeout(() => {
			editRef.current?.focus();
			editRef.current?.select();
		}, 50);
	};

	const commitRename = () => {
		if (!editingId) return;
		update({
			...layout,
			folders: {
				...layout.folders,
				[editingId]: { ...layout.folders[editingId]!, name: editName.trim() || "Untitled" },
			},
		});
		setEditingId(null);
	};

	const deleteFolder = (id: string) => {
		const folder = layout.folders[id];
		if (!folder) return;
		const idx = layout.topLevel.findIndex((i) => i.type === "folder" && i.id === id);
		const returned = folder.projectIds.map((ws) => ({ type: "project" as const, workspaceId: ws }));
		const topLevel = [...layout.topLevel];
		topLevel.splice(idx, 1, ...returned);
		const folders = { ...layout.folders };
		delete folders[id];
		update({ ...layout, topLevel, folders });
	};

	const toggleCollapse = (id: string) => {
		const f = layout.folders[id];
		if (!f) return;
		update({ ...layout, folders: { ...layout.folders, [id]: { ...f, collapsed: !f.collapsed } } });
	};

	// ── Drag and drop ─────────────────────────────────────────────────────────

	const onDragUpdate = useCallback(
		(update: import("@hello-pangea/dnd").DragUpdate) => {
			if (!update.destination) {
				setHoveredFolderId(null);
				return;
			}
			const flat = buildFlat(layout, true, true);
			// Simulate source removal so destination index is accurate
			flat.splice(update.source.index, 1);
			const folderId = folderAtDest(flat, update.destination.index);
			setHoveredFolderId(folderId);
		},
		[layout],
	);

	const onDragEnd = (result: DropResult) => {
		setIsDragging(false);
		setHoveredFolderId(null);
		if (!result.destination) return;
		const { draggableId, source, destination } = result;
		if (source.index === destination.index) return;

		// Must use the SAME flat list as was rendered (with slots) so indices match
		const flat = buildFlat(layout, true, true);

		if (draggableId.startsWith("fh:")) {
			// ── Moving a folder header — bring all its projects (and slot) along ──
			const folderId = draggableId.slice(3);
			flat.splice(source.index, 1);
			const group: FlatItem[] = [];
			while (
				flat[source.index] &&
				((flat[source.index]!.kind === "project" &&
					(flat[source.index] as Extract<FlatItem, { kind: "project" }>).folderId === folderId) ||
					(flat[source.index]!.kind === "empty-folder-slot" &&
						(flat[source.index] as Extract<FlatItem, { kind: "empty-folder-slot" }>).folderId === folderId))
			) {
				group.push(flat.splice(source.index, 1)[0]!);
			}
			// Insert header + projects at destination (clamped)
			const at = Math.min(destination.index, flat.length);
			flat.splice(at, 0, { kind: "folder-header", folderId }, ...group);
		} else {
			// ── Moving a project ──
			const [moved] = flat.splice(source.index, 1);
			// Determine folder from what's before the destination slot
			const newFolderId = folderAtDest(flat, destination.index);
			flat.splice(destination.index, 0, { ...moved!, folderId: newFolderId } as FlatItem);
		}

		update(flatToLayout(flat, layout));
	};

	// ── Render ────────────────────────────────────────────────────────────────

	const projectMap = Object.fromEntries(projects.map((p) => [p.workspaceId, p]));
	const flat = buildFlat(layout, isDragging, isDragging);

	return (
		<DragDropContext onDragStart={() => setIsDragging(true)} onDragUpdate={onDragUpdate} onDragEnd={onDragEnd}>
			<Droppable droppableId="sidebar">
				{(provided) => (
					<div ref={provided.innerRef} {...provided.droppableProps} className="flex flex-col">
						{flat.map((item, index) => {
							if (item.kind === "folder-header") {
								const folder = layout.folders[item.folderId];
								if (!folder) return null;
								const expanded = !folder.collapsed || isDragging;
								return (
									<Draggable key={`fh:${item.folderId}`} draggableId={`fh:${item.folderId}`} index={index}>
										{(dp, snap) => (
											<div
												ref={dp.innerRef}
												{...dp.draggableProps}
												{...dp.dragHandleProps}
												onClick={() => toggleCollapse(item.folderId)}
												className="group flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-md my-px mx-1 cursor-pointer select-none transition-colors"
												style={{
													...dp.draggableProps.style,
													background: snap.isDragging
														? "#1f1f28"
														: hoveredFolderId === item.folderId
															? "#7c6aff15"
															: "transparent",
												}}
											>
												{/* Chevron */}
												<div className="shrink-0 flex items-center justify-center w-3.5 text-[#4a4a5a]">
													{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
												</div>

												{/* Folder icon */}
												<Folder
													size={13}
													className={classNames(
														"shrink-0",
														hoveredFolderId === item.folderId ? "text-[#7c6aff]" : "text-[#60607a]",
													)}
												/>

												{/* Name */}
												{editingId === item.folderId ? (
													<input
														ref={editRef}
														value={editName}
														onChange={(e) => setEditName(e.target.value)}
														onBlur={commitRename}
														onClick={(e) => e.stopPropagation()}
														onKeyDown={(e) => {
															if (e.key === "Enter") commitRename();
															if (e.key === "Escape") setEditingId(null);
														}}
														className="flex-1 min-w-0 outline-none text-[11px] rounded px-1 bg-[#0c0c0f] border border-[#3a3a55] text-[#f0f0f5]"
													/>
												) : (
													<span
														className={classNames(
															"flex-1 min-w-0 truncate text-[11px] font-medium tracking-[0.2px]",
															hoveredFolderId === item.folderId ? "text-[#c0c0d0]" : "text-[#8888a0]",
														)}
														onDoubleClick={(e) => {
															e.stopPropagation();
															startRename(item.folderId);
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
															startRename(item.folderId);
														}}
														className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#2a2a35] transition-colors text-[#60607a]"
														title="Rename"
													>
														<Pencil size={10} />
													</button>
													<button
														onClick={(e) => {
															e.stopPropagation();
															deleteFolder(item.folderId);
														}}
														className="flex items-center justify-center w-5 h-5 rounded hover:bg-[#ef444420] transition-colors text-[#60607a]"
														title="Delete"
													>
														<Trash2 size={10} />
													</button>
												</span>
											</div>
										)}
									</Draggable>
								);
							}

							// Empty folder drop zone
							if (item.kind === "empty-folder-slot") {
								return (
									<Draggable
										key={`slot:${item.folderId}`}
										draggableId={`slot:${item.folderId}`}
										index={index}
										isDragDisabled
									>
										{(dp) => (
											<div
												ref={dp.innerRef}
												{...dp.draggableProps}
												{...dp.dragHandleProps}
												className="pl-10 pr-2.5 py-[3px]"
											>
												<div className="h-7 border border-dashed border-[#2a2a35] rounded-md flex items-center pl-2.5 gap-1.5">
													<div className="w-1 h-1 rounded-full bg-[#2a2a35]" />
													<span className="text-[10px] text-[#3a3a45]">Drop project here</span>
												</div>
											</div>
										)}
									</Draggable>
								);
							}

							// Project item
							const project = projectMap[item.workspaceId];
							if (!project) return null;
							const isActive = item.workspaceId === activeWorkspaceId;
							const indent = item.folderId !== null;
							return (
								<Draggable key={`p:${item.workspaceId}`} draggableId={`p:${item.workspaceId}`} index={index}>
									{(dp, snap) => (
										<div
											ref={dp.innerRef}
											{...dp.draggableProps}
											{...dp.dragHandleProps}
											onClick={() => onSwitch(item.workspaceId)}
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
												className={classNames(
													"w-1.5 h-1.5 rounded-full shrink-0",
													isActive ? "bg-[#7c6aff]" : "bg-[#2a2a35]",
												)}
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
															content: `Remove "${project.name}" from Overemployed? This will stop all running agents and delete all associated worktrees and data.`,
															confirmButtonLabel: "Remove",
															cancelButtonLabel: "Cancel",
															onConfirm: async ({ dismiss }) => {
																await onRemove(item.workspaceId);
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
									)}
								</Draggable>
							);
						})}
						{provided.placeholder}
					</div>
				)}
			</Droppable>
		</DragDropContext>
	);
});
