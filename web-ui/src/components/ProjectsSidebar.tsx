import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import type { ProjectsLayout, RuntimeProject } from "@runtime-contract";
import { ChevronDown, ChevronRight, Folder, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

function genId() {
	return Math.random().toString(36).slice(2, 10);
}

// ── Flat-list helpers ─────────────────────────────────────────────────────────

type FlatItem =
	| { kind: "folder-header"; folderId: string }
	| { kind: "project"; workspaceId: string; folderId: string | null };

/** Build the ordered flat array including folder headers. */
function buildFlat(layout: ProjectsLayout, expandAll: boolean): FlatItem[] {
	const flat: FlatItem[] = [];
	for (const item of layout.topLevel) {
		if (item.type === "folder") {
			flat.push({ kind: "folder-header", folderId: item.id });
			if (expandAll || !layout.folders[item.id]?.collapsed) {
				for (const wsId of layout.folders[item.id]?.projectIds ?? []) {
					flat.push({ kind: "project", workspaceId: wsId, folderId: item.id });
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

/** What folder does a drop at `destIndex` land in (after source removal)? */
function folderAtDest(flat: FlatItem[], destIndex: number): string | null {
	// Walk backwards from destIndex to find the nearest folder header or same-folder project.
	for (let i = destIndex - 1; i >= 0; i--) {
		const item = flat[i]!;
		if (item.kind === "folder-header") return item.folderId;
		if (item.kind === "project") return item.folderId; // could be null (ungrouped)
	}
	return null; // before everything → ungrouped
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
}

export function ProjectsSidebar({ projects, activeWorkspaceId, onSwitch }: Props) {
	const [layout, setLayout] = useState<ProjectsLayout>({ version: 1, topLevel: [], folders: {} });
	const [isDragging, setIsDragging] = useState(false);
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

	const onDragEnd = (result: DropResult) => {
		setIsDragging(false);
		if (!result.destination) return;
		const { draggableId, source, destination } = result;
		if (source.index === destination.index) return;

		// Rebuild flat with all folders expanded during drag
		const flat = buildFlat(layout, true);

		if (draggableId.startsWith("fh:")) {
			// ── Moving a folder header — bring all its projects along ──
			const folderId = draggableId.slice(3);
			// Remove header from flat
			flat.splice(source.index, 1);
			// Collect the folder's project items that now sit at source.index
			const group: FlatItem[] = [];
			while (
				flat[source.index]?.kind === "project" &&
				(flat[source.index] as Extract<FlatItem, { kind: "project" }>).folderId === folderId
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
	const flat = buildFlat(layout, isDragging);

	return (
		<DragDropContext onDragStart={() => setIsDragging(true)} onDragEnd={onDragEnd}>
			<div className="flex items-center justify-between px-4 mb-1">
				<p className="text-[10px] font-medium text-[#60607a]">Projects</p>
				<button onClick={addFolder} title="New folder" className="text-[#60607a] hover:text-gray-400 transition-colors">
					<Plus size={12} />
				</button>
			</div>

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
												className={`group flex items-center gap-1.5 py-1.5 pr-2 pl-4 text-xs text-[#8888a0] hover:text-[#c0c0d0] transition-colors
                          ${snap.isDragging ? "opacity-60 bg-[#1f1f28] rounded" : ""}`}
											>
												<span
													{...dp.dragHandleProps}
													className="shrink-0 text-gray-700 hover:text-gray-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
												>
													<GripVertical size={11} />
												</span>
												<button onClick={() => toggleCollapse(item.folderId)} className="shrink-0 text-[#60607a]">
													{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
												</button>
												<Folder size={12} className="shrink-0 text-[#60607a]" />
												{editingId === item.folderId ? (
													<input
														ref={editRef}
														value={editName}
														onChange={(e) => setEditName(e.target.value)}
														onBlur={commitRename}
														onKeyDown={(e) => {
															if (e.key === "Enter") commitRename();
															if (e.key === "Escape") setEditingId(null);
														}}
														className="flex-1 min-w-0 bg-gray-800 text-gray-100 text-xs px-1 rounded outline-none border border-gray-600"
													/>
												) : (
													<span
														className="flex-1 min-w-0 truncate"
														onDoubleClick={() => startRename(item.folderId)}
													>
														{folder.name}
													</span>
												)}
												<span className="shrink-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
													<button
														onClick={() => startRename(item.folderId)}
														className="p-0.5 hover:text-gray-200"
														title="Rename"
													>
														<Pencil size={10} />
													</button>
													<button
														onClick={() => deleteFolder(item.folderId)}
														className="p-0.5 hover:text-red-400"
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
											className={`group flex items-center gap-1.5 py-[6px] pr-3 text-xs transition-colors
                        ${indent ? "pl-9" : "pl-4"}
                        ${snap.isDragging ? "opacity-70" : ""}
                        ${isActive && !snap.isDragging
                          ? "bg-[#1f1f28] border-l-2 border-[#7c6aff] text-[#f0f0f5]"
                          : "text-[#8888a0] hover:text-[#c0c0d0] hover:bg-[#181820] rounded-sm"}`}
										>
											<span
												{...dp.dragHandleProps}
												className="shrink-0 text-gray-700 hover:text-gray-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
											>
												<GripVertical size={11} />
											</span>
											<button
												onClick={() => onSwitch(item.workspaceId)}
												className="flex items-center gap-2 flex-1 min-w-0 text-left"
											>
												{isActive && (
													<span
														className="size-[6px] rounded-full shrink-0 bg-blue-400"
														style={{ boxShadow: "0 0 4px rgba(59,130,246,0.5)" }}
													/>
												)}
												<span className="truncate">{project.name}</span>
											</button>
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
}
