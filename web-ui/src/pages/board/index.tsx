import { Menu, MenuItem, MenuTrigger, toast } from "@geckoui/geckoui";
import { FolderOpen, FolderPlus, Plus, Settings, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RuntimeProject } from "@runtime-contract";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { type ProjectsSidebarHandle, ProjectsSidebar } from "@/components/ProjectsSidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { useWorkspaceState } from "@/stores/board-store";
import { useRead, useWrite } from "@/runtime/api-client";
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

	const { trigger: fetchProjects } = useRead((api) => api("projects").GET(), { enabled: false });
	const { trigger: fetchLayout } = useRead((api) => api("projects/layout").GET(), { enabled: false });
	const { trigger: removeProject } = useWrite((api) => api("projects/:workspaceId").DELETE());

	const activeProject = projects.find((p) => p.workspaceId === workspaceId) ?? null;

	useEffect(() => {
		loadProjects();
	}, []);

	const loadProjects = async () => {
		try {
			const [{ data: list }, { data: layout }] = await Promise.all([fetchProjects(), fetchLayout()]);
			const projectList = list ?? [];
			setProjects(projectList);
			if (projectList.length > 0) {
				const valid = projectList.some((p) => p.workspaceId === workspaceId);
				if (!valid) {
					const id = (layout ? firstSortedProjectId(layout, projectList) : null) ?? projectList[0]!.workspaceId;
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

	const handleRemoveProject = async (wsId: string) => {
		await removeProject({ params: { workspaceId: wsId } });
		const updated = projects.filter((p) => p.workspaceId !== wsId);
		setProjects(updated);
		if (wsId === workspaceId) {
			const [first, { data: layout }] = await Promise.all([
				Promise.resolve(updated),
				fetchLayout().catch(() => ({ data: null })),
			]);
			const nextId = (layout ? firstSortedProjectId(layout, first) : null) ?? first[0]?.workspaceId;
			if (nextId) {
				navigate(`/${encodeURIComponent(nextId)}/board`, { replace: true });
			} else {
				navigate("/", { replace: true });
			}
		}
	};

	return (
		<div className="flex h-full overflow-hidden">
			{/* Sidebar */}
			<nav className="w-[220px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
				{/* Logo header */}
				<div className="flex items-center shrink-0 gap-2.5 px-4 py-[18px]">
					<div className="shrink-0 w-6 h-6 rounded-md bg-[#7c6aff] flex items-center justify-center">
						<svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<rect x="1" y="4" width="9" height="7" rx="1.2" fill="white" fillOpacity="0.35" />
							<path
								d="M3 4V3C3 2.45 3.45 2 4 2H7C7.55 2 8 2.45 8 3V4"
								stroke="white"
								strokeOpacity="0.35"
								strokeWidth="1.1"
								strokeLinecap="round"
							/>
							<rect x="6" y="7" width="9" height="7.5" rx="1.2" fill="#7c6aff" stroke="white" strokeWidth="1.25" />
							<path
								d="M8 7V6C8 5.45 8.45 5 9 5H12C12.55 5 13 5.45 13 6V7"
								stroke="white"
								strokeWidth="1.25"
								strokeLinecap="round"
							/>
							<line x1="6" y1="10.5" x2="15" y2="10.5" stroke="white" strokeWidth="1" strokeOpacity="0.5" />
						</svg>
					</div>
					<span className="text-[14px] font-bold text-[#f0f0f5]">Whipped</span>
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
							onRemove={handleRemoveProject}
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
