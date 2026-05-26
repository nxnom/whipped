import { toast } from "@geckoui/geckoui";
import { Plus, Settings, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { RuntimeProject } from "@runtime-contract";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { ProjectsSidebar } from "@/components/ProjectsSidebar";
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

	const autonomousOn = state?.autonomousModeEnabled ?? false;
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
			<nav className="w-52 shrink-0 bg-[#141418] border-r border-[#2a2a35] flex flex-col">
				<div className="px-4 py-3.5 border-b border-[#2a2a35] shrink-0 flex items-center gap-2">
					<div
						className="size-[22px] rounded-[5px] shrink-0"
						style={{ background: "linear-gradient(135deg, #7c6aff 0%, #a78bfa 100%)" }}
					/>
					<span className="text-sm font-bold text-white tracking-tight">Overemployed</span>
				</div>

				<div className="flex-1 overflow-y-auto py-2">
					<ProjectsSidebar projects={projects} activeWorkspaceId={workspaceId ?? null} onSwitch={switchProject} />
					{projects.length === 0 && <p className="px-4 py-2 text-xs text-gray-600">No projects yet</p>}
				</div>

				{autonomousOn && (
					<div className="border-t border-[#2a2a35] shrink-0 px-4 py-2.5 flex items-center gap-2 bg-[#3b82f6]/5">
						<span
							className="size-2 rounded-full bg-blue-500 shrink-0"
							style={{ boxShadow: "0 0 6px rgba(59,130,246,0.4)" }}
						/>
						<span className="text-xs font-medium text-blue-400">Autonomous</span>
					</div>
				)}

				<div className="border-t border-[#2a2a35] shrink-0 px-4 py-2.5 flex items-center gap-2">
					{connected ? (
						<Wifi size={14} className="text-emerald-400" />
					) : (
						<Wifi size={14} className="text-gray-700" />
					)}
					<div className="flex-1" />
					<button
						onClick={() => setShowAddProject(true)}
						className="text-gray-600 hover:text-gray-400 transition-colors"
						title="Add project"
					>
						<Plus size={14} />
					</button>
					<button
						onClick={() => {
							if (workspaceId) navigate(`/${encodeURIComponent(workspaceId)}/settings`);
						}}
						className="text-gray-600 hover:text-gray-400 transition-colors"
						title="Settings"
					>
						<Settings size={14} />
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
