import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import type { ProjectsLayout, RuntimeProject } from "@runtime-contract";
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRead, useWrite } from "@/runtime/api-client";
import { EmptyFolderSlot } from "./EmptyFolderSlot";
import { FolderHeader } from "./FolderHeader";
import { buildFlat, flatToLayout, folderAtDest, genId, syncLayout } from "./helpers";
import { ProjectItem } from "./ProjectItem";
import type { FlatItem } from "./types";

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

	const { trigger: fetchLayout } = useRead((api) => api("projects/layout").GET(), { enabled: false });
	const { trigger: saveLayout } = useWrite((api) => api("projects/layout").PUT());

	useEffect(() => {
		fetchLayout()
			.then((res) => setLayout((prev) => syncLayout(res.data ?? prev, projects)))
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		setLayout((prev) => syncLayout(prev, projects));
	}, [projects]);

	const persist = (next: ProjectsLayout) => {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			saveLayout({ body: next }).catch(() => {});
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
											<FolderHeader
												folderId={item.folderId}
												folder={folder}
												dp={dp}
												snap={snap}
												expanded={expanded}
												hovered={hoveredFolderId === item.folderId}
												editing={editingId === item.folderId}
												editName={editName}
												editRef={editRef}
												onToggleCollapse={toggleCollapse}
												onStartRename={startRename}
												onDeleteFolder={deleteFolder}
												onEditNameChange={setEditName}
												onCommitRename={commitRename}
												onCancelRename={() => setEditingId(null)}
											/>
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
										{(dp) => <EmptyFolderSlot dp={dp} />}
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
										<ProjectItem
											project={project}
											workspaceId={item.workspaceId}
											dp={dp}
											snap={snap}
											isActive={isActive}
											indent={indent}
											onSwitch={onSwitch}
											onRemove={onRemove}
										/>
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
