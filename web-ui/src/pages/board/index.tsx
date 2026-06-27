import { Menu, MenuItem, MenuTrigger } from "@geckoui/geckoui";
import { Clock, FolderOpen, FolderPlus, Plus, Settings, Star, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { type ProjectsSidebarHandle, ProjectsSidebar } from "@/components/ProjectsSidebar";
import { KanbanBoard } from "./components/KanbanBoard";
import { UpdateBanner } from "./components/UpdateBanner";
import { useWorkspaceState } from "@/stores/board-store";
import { useRead, useWrite } from "@/runtime/api-client";
import { firstSortedProjectId } from "@/utils/projects";
import logo from "@/assets/logo.png";

interface Props {
	onOpenAgent: () => void;
}

export function BoardPage({ onOpenAgent }: Props) {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const { state, connected, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId!);

	const [showAddProject, setShowAddProject] = useState(false);
	const sidebarRef = useRef<ProjectsSidebarHandle>(null);

	// Declarative reads — adding/removing a project is a `projects` write, so the
	// list (and layout) auto-invalidate and refetch; no manual reload needed.
	const { data: projectList } = useRead((api) => api("projects").GET());
	const { data: layout } = useRead((api) => api("projects/layout").GET());
	const { data: recurringAgents } = useRead(
		(api) => api("recurring-agents").GET({ query: { workspaceId: workspaceId! } }),
		{ enabled: !!workspaceId },
	);
	const { trigger: removeProject } = useWrite((api) => api("projects/:workspaceId").DELETE());

	const recurringCount = recurringAgents?.length ?? 0;
	const projects = projectList ?? [];
	const activeProject = projects.find((p) => p.workspaceId === workspaceId) ?? null;

	// Redirect to a valid project whenever the current workspaceId isn't one of them.
	useEffect(() => {
		if (projects.length === 0) return;
		if (projects.some((p) => p.workspaceId === workspaceId)) return;
		const id = (layout ? firstSortedProjectId(layout, projects) : null) ?? projects[0]!.workspaceId;
		navigate(`/${encodeURIComponent(id)}/board`);
	}, [projectList, layout, workspaceId, navigate]);

	const switchProject = (wsId: string) => {
		navigate(`/${encodeURIComponent(wsId)}/board`);
	};

	const handleRemoveProject = async (wsId: string) => {
		await removeProject({ params: { workspaceId: wsId } });
		if (wsId !== workspaceId) return;
		const remaining = projects.filter((p) => p.workspaceId !== wsId);
		const nextId = (layout ? firstSortedProjectId(layout, remaining) : null) ?? remaining[0]?.workspaceId;
		navigate(nextId ? `/${encodeURIComponent(nextId)}/board` : "/");
	};

	return (
		<div className="flex h-full overflow-hidden">
			{/* Sidebar */}
			<nav className="w-[220px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
				{/* Logo header */}
				<div className="flex items-center shrink-0 gap-1 px-4 py-[18px]">
					<img src={logo} alt="Whipped" className="shrink-0 size-8 rounded-md object-cover" />
					<span className="text-lg font-bold text-neutral-300 italic">Whipped</span>
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

				{/* Footer nav */}
				<div className="border-t border-[#2a2a35] py-3 px-4 gap-1.5 flex flex-col">
					<button
						onClick={() => {
							if (workspaceId) navigate(`/${encodeURIComponent(workspaceId)}/recurring-agents`);
						}}
						className="flex items-center gap-2.5 py-1.5 px-0.5 hover:opacity-80 transition-opacity cursor-pointer"
					>
						<Clock size={15} className="text-[#60607a]" />
						<span className="text-[12px] text-[#8888a0]">Recurring Agents</span>
						{recurringCount > 0 && (
							<span className="ml-auto min-w-[18px] text-center text-[11px] font-medium text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35] rounded px-1.5 py-px">
								{recurringCount}
							</span>
						)}
					</button>
					<button
						onClick={() => {
							if (workspaceId) navigate(`/${encodeURIComponent(workspaceId)}/settings`);
						}}
						className="flex items-center gap-2.5 py-1.5 px-0.5 hover:opacity-80 transition-opacity cursor-pointer"
					>
						<Settings size={15} className="text-[#60607a]" />
						<span className="text-[12px] text-[#8888a0]">Global Settings</span>
					</button>
					<a
						href="https://github.com/nxnom/whipped"
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-2.5 -mx-2 pl-[10px] pr-2 py-1.5 rounded-[6px] border border-[#2a2a35] text-[#60607a] hover:text-[#c0c0d0] hover:border-[#3a3a45] hover:bg-[#1a1a1f] transition-colors cursor-pointer"
					>
						<Star size={15} className="shrink-0" />
						<span className="text-[12px]">Star on GitHub</span>
					</a>
				</div>
			</nav>

			{/* Main content */}
			<div className="flex-1 overflow-hidden flex flex-col min-h-0">
				<UpdateBanner />
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
						navigate(`/${encodeURIComponent(wsId)}/board`);
						setShowAddProject(false);
					}}
				/>
			)}
		</div>
	);
}
