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
			const list = await trpc.projects.list.query();
			setProjects(list);
			if (list.length > 0) {
				const valid = list.some((p) => p.workspaceId === workspaceId);
				if (!valid) navigate(`/${encodeURIComponent(list[0]!.workspaceId)}/board`, { replace: true });
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
			<nav
				className="shrink-0 flex flex-col"
				style={{ width: 220, background: "#141418", borderRight: "1px solid #2a2a35" }}
			>
				{/* Logo header */}
				<div className="flex items-center shrink-0" style={{ gap: 10, padding: "18px 16px" }}>
					<div className="shrink-0" style={{ width: 24, height: 24, borderRadius: 6, background: "#7c6aff" }} />
					<span className="text-[14px] font-bold" style={{ color: "#f0f0f5" }}>
						Overemployed
					</span>
				</div>

				<div style={{ height: 1, background: "#2a2a35", flexShrink: 0 }} />

				{/* PROJECTS section header */}
				<div className="flex items-center shrink-0" style={{ padding: "14px 16px 8px 16px" }}>
					<span className="text-[10px] font-semibold" style={{ color: "#60607a", letterSpacing: 0.8 }}>
						PROJECTS
					</span>
					<div style={{ flex: 1 }} />
					<Menu placement="bottom-end">
						<MenuTrigger>
							{({ toggleMenu }) => (
								<button onClick={toggleMenu} className="hover:opacity-70 transition-opacity" title="Add">
									<Plus size={14} style={{ color: "#60607a" }} />
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
						<div className="flex items-center" style={{ gap: 8, padding: "20px 16px" }}>
							<FolderOpen size={24} style={{ color: "#2a2a35" }} />
							<span className="text-[12px]" style={{ color: "#60607a" }}>
								No projects yet
							</span>
						</div>
					)}
				</div>

				{/* Global Settings */}
				<div
					style={{
						borderTop: "1px solid #2a2a35",
						padding: "12px 16px",
						gap: 6,
						display: "flex",
						flexDirection: "column",
					}}
				>
					<button
						onClick={() => {
							if (workspaceId) navigate(`/${encodeURIComponent(workspaceId)}/settings`);
						}}
						className="flex items-center hover:opacity-80 transition-opacity"
						style={{ gap: 10, padding: "6px 2px" }}
					>
						<Settings size={15} style={{ color: "#60607a" }} />
						<span className="text-[12px]" style={{ color: "#8888a0" }}>
							Global Settings
						</span>
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
