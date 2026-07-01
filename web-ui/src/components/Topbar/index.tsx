import { MessageSquare, Settings } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { useRead, useWrite } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import { classNames } from "@/utils/classNames";
import { firstSortedProjectId } from "@/utils/projects";
import logo from "@/assets/logo.png";
import { PrimaryNav } from "./PrimaryNav";
import { ProjectSwitcher } from "./ProjectSwitcher";

interface TopbarProps {
	workspaceId: string;
	onOpenAgent: () => void;
}

export function Topbar({ workspaceId, onOpenAgent }: TopbarProps) {
	const navigate = useNavigate();
	const { connected } = useWorkspaceState(workspaceId);
	const { data: projectList } = useRead((api) => api("projects").GET());
	const { data: layout } = useRead((api) => api("projects/layout").GET());
	const { data: recurringAgents } = useRead((api) => api("recurring-agents").GET({ query: { workspaceId } }));
	const { trigger: removeProject } = useWrite((api) => api("projects/:workspaceId").DELETE());
	const [showAddProject, setShowAddProject] = useState(false);

	const recurringCount = recurringAgents?.length ?? 0;

	const projects = projectList ?? [];
	const activeProject = projects.find((p) => p.workspaceId === workspaceId) ?? null;

	const switchProject = (wsId: string) => navigate(`/${encodeURIComponent(wsId)}/board`);

	const handleRemoveProject = async (wsId: string) => {
		await removeProject({ params: { workspaceId: wsId } });
		if (wsId !== workspaceId) return;
		const remaining = projects.filter((p) => p.workspaceId !== wsId);
		const nextId = (layout ? firstSortedProjectId(layout, remaining) : null) ?? remaining[0]?.workspaceId;
		navigate(nextId ? `/${encodeURIComponent(nextId)}/board` : "/");
	};

	return (
		<>
			<header className="flex items-center gap-4 h-16 px-5 shrink-0 bg-[#050505] border-b border-[#1f1f1f]">
				<div className="flex items-center gap-2.5 w-[170px] shrink-0">
					<img src={logo} alt="Whipped" className="shrink-0 size-7 rounded-[7px] object-cover" />
					<span className="text-[17px] font-bold text-[#ededed]">Whipped</span>
				</div>

				<ProjectSwitcher
					projects={projects}
					activeProject={activeProject}
					activeWorkspaceId={workspaceId}
					onSwitch={switchProject}
					onRemove={handleRemoveProject}
					onAddProject={() => setShowAddProject(true)}
				/>

				<PrimaryNav workspaceId={workspaceId} recurringCount={recurringCount} />

				<div className="flex-1" />

				<div className="flex items-center gap-1.5 px-2.5 py-[7px] rounded-md bg-[#111111] border border-[#2a2a2a]">
					<span className={classNames("size-[7px] rounded-full", connected ? "bg-[#22c55e]" : "bg-[#5f6672]")} />
					<span className="text-xs font-medium text-[#8a8f98]">{connected ? "Connected" : "Offline"}</span>
				</div>
				<button onClick={onOpenAgent} className="p-1.5 text-[#8a8f98] hover:text-[#ededed] transition-colors">
					<MessageSquare size={18} />
				</button>
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/settings`)}
					className="p-1.5 text-[#8a8f98] hover:text-[#ededed] transition-colors"
				>
					<Settings size={18} />
				</button>
			</header>

			{showAddProject && (
				<AddProjectDialog
					onClose={() => setShowAddProject(false)}
					onAdded={(wsId) => {
						navigate(`/${encodeURIComponent(wsId)}/board`);
						setShowAddProject(false);
					}}
				/>
			)}
		</>
	);
}
