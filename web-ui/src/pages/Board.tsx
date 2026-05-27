import { Menu, MenuItem, MenuTrigger, toast } from "@geckoui/geckoui";
import { FolderOpen, FolderPlus, Plus, Settings, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RuntimeProject } from "@runtime-contract";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { type ProjectsSidebarHandle, ProjectsSidebar } from "@/components/ProjectsSidebar";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { useWorkspaceState } from "@/stores/board-store";
import { trpc } from "@/runtime/trpc-client";
import { firstSortedProjectId } from "@/utils/projects";

interface Props {
	onOpenAgent: () => void;
}

export function BoardPage({ onOpenAgent }: Props) {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const { state, connected, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId!);

	const [projects, setProjects] = useState<RuntimeProject[]>([]);
	const [showAddProject, setShowAddProject] = useState(false);
	const sidebarRef = useRef<ProjectsSidebarHandle>(null);

	const activeProject = projects.find((p) => p.workspaceId === workspaceId) ?? null;

	useEffect(() => {
		loadProjects();
	}, []);

	const loadProjects = async () => {
		try {
			const [list, layout] = await Promise.all([trpc.projects.list.query(), trpc.projects.getLayout.query()]);
			setProjects(list);
			if (list.length > 0) {
				const valid = list.some((p) => p.workspaceId === workspaceId);
				if (!valid) {
					const id = (layout ? firstSortedProjectId(layout, list) : null) ?? list[0]!.workspaceId;
					navigate(`/${encodeURIComponent(id)}/board`, { replace: true });
				}
			}
		} catch {
			toast.error("Failed to load projects");
		}
	};

	const switchProject = (wsId: string) => {
		navigate(`/${encodeURIComponent(wsId)}/board`);
	};

	return (
		<div className="flex h-full overflow-hidden">
			{/* Sidebar */}
			<nav className="w-[220px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
				{/* Logo header */}
				<div className="flex items-center shrink-0 gap-2.5 px-4 py-[18px]">
					<div className="shrink-0 w-6 h-6 rounded-md bg-[#7c6aff]" />
					<span className="text-[14px] font-bold text-[#f0f0f5]">Overemployed</span>
				</div>

				<div className="h-px bg-[#2a2a35] shrink-0" />

				{/* PROJECTS section header */}
				<div className="flex items-center shrink-0 pt-[14px] px-4 pb-2">
					<span className="text-[10px] font-semibold text-[#60607a] tracking-[0.8px]">PROJECTS</span>
					<div className="flex-1" />
					<Menu placement="bottom-end">
						<MenuTrigger>
							{({ toggleMenu }) => (
								<button onClick={toggleMenu} className="hover:opacity-70 transition-opacity" title="Add">
									<Plus size={14} className="text-[#60607a]" />
								</button>
							)}
						</MenuTrigger>
						<MenuItem onClick={() => setShowAddProject(true)}>
							<span className="flex items-center gap-1.5">
								<Plus size={12} /> Add Project
							</span>
						</MenuItem>
						<MenuItem onClick={() => sidebarRef.current?.addFolder()}>
							<span className="flex items-center gap-1.5">
								<FolderPlus size={12} /> New Folder
							</span>
						</MenuItem>
					</Menu>
				</div>

				{/* Project list */}
				<div className="flex-1 overflow-y-auto">
					{projects.length > 0 ? (
						<ProjectsSidebar
							ref={sidebarRef}
							projects={projects}
							activeWorkspaceId={workspaceId ?? null}
							onSwitch={switchProject}
						/>
					) : (
						<div className="flex items-center gap-2 py-5 px-4">
							<FolderOpen size={24} className="text-[#2a2a35]" />
							<span className="text-[12px] text-[#60607a]">No projects yet</span>
						</div>
					)}
				</div>

				{/* Global Settings */}
				<div className="border-t border-[#2a2a35] py-3 px-4 gap-1.5 flex flex-col">
					<button
						onClick={() => {
							if (workspaceId) navigate(`/${encodeURIComponent(workspaceId)}/settings`);
						}}
						className="flex items-center gap-2.5 py-1.5 px-0.5 hover:opacity-80 transition-opacity"
					>
						<Settings size={15} className="text-[#60607a]" />
						<span className="text-[12px] text-[#8888a0]">Global Settings</span>
					</button>
				</div>
			</nav>

			{/* Main content */}
			<div className="flex-1 overflow-hidden flex flex-col min-h-0">
				{!connected && !state ? (
					<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-500">
						<WifiOff size={32} />
						<p className="text-sm">Connecting to server...</p>
					</div>
				) : !state ? (
					<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
				) : (
					<KanbanBoard
						state={state}
						onRefresh={refetch}
						onDeleteCard={optimisticDeleteCard}
						onOpenSettings={() => navigate(`/${encodeURIComponent(workspaceId!)}/settings`)}
						onOpenAgent={onOpenAgent}
						projectName={activeProject?.name}
					/>
				)}
			</div>

			{showAddProject && (
				<AddProjectDialog
					onClose={() => setShowAddProject(false)}
					onAdded={(wsId) => {
						loadProjects();
						navigate(`/${encodeURIComponent(wsId)}/board`);
						setShowAddProject(false);
					}}
				/>
			)}
		</div>
	);
}
