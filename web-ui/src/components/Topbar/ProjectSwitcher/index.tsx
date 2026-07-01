import { Menu, MenuTrigger } from "@geckoui/geckoui";
import type { RuntimeProject } from "@runtime-contract";
import { ChevronDown, FolderOpen, FolderPlus, Plus, Search, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ProjectsSidebarHandle, ProjectsSidebar } from "@/components/ProjectsSidebar";

interface ProjectSwitcherProps {
	projects: RuntimeProject[];
	activeProject: RuntimeProject | null;
	activeWorkspaceId: string;
	onSwitch: (workspaceId: string) => void;
	onRemove: (workspaceId: string) => Promise<void>;
	onAddProject: () => void;
}

export function ProjectSwitcher({
	projects,
	activeProject,
	activeWorkspaceId,
	onSwitch,
	onRemove,
	onAddProject,
}: ProjectSwitcherProps) {
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const sidebarRef = useRef<ProjectsSidebarHandle>(null);

	const keyword = search.trim().toLowerCase();
	const filtered = keyword ? projects.filter((p) => p.name.toLowerCase().includes(keyword)) : projects;

	return (
		<Menu
			placement="bottom-start"
			menuClassName="w-[336px] p-2 flex flex-col gap-1.5 bg-[#111111] border border-[#2a2a2a] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
		>
			<MenuTrigger>
				{({ toggleMenu }) => (
					<button
						onClick={toggleMenu}
						className="flex items-center gap-2.5 h-[38px] px-3 rounded-md bg-[#111111] border border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors min-w-[220px]"
					>
						<FolderOpen size={16} className="text-[#8a8f98] shrink-0" />
						<div className="flex-1 min-w-0 text-left">
							<p className="text-[10px] font-medium text-[#5f6672] leading-none">Personal</p>
							<p className="text-[13px] font-semibold text-[#ededed] truncate leading-tight mt-0.5">
								{activeProject?.name ?? "Select project"}
							</p>
						</div>
						<ChevronDown size={14} className="text-[#8a8f98] shrink-0" />
					</button>
				)}
			</MenuTrigger>

			<div className="flex items-center gap-2 h-[34px] px-2.5 rounded-md bg-[#050505] border border-[#1f1f1f]">
				<Search size={14} className="text-[#5f6672] shrink-0" />
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Find project..."
					className="flex-1 min-w-0 bg-transparent outline-none text-xs text-[#ededed] placeholder:text-[#5f6672]"
				/>
			</div>

			<button
				onClick={onAddProject}
				className="flex items-center gap-2 h-9 px-2.5 rounded-md bg-[#ededed] hover:bg-white transition-colors"
			>
				<Plus size={14} className="text-[#050505]" />
				<span className="text-xs font-bold text-[#050505]">New Project</span>
			</button>

			<div className="max-h-[320px] overflow-y-auto -mx-1">
				<ProjectsSidebar
					ref={sidebarRef}
					projects={filtered}
					activeWorkspaceId={activeWorkspaceId}
					onSwitch={onSwitch}
					onRemove={onRemove}
				/>
			</div>

			<div className="flex items-center gap-2 pt-2 border-t border-[#1f1f1f]">
				<button
					onClick={() => sidebarRef.current?.addFolder()}
					className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md bg-[#050505] border border-[#1f1f1f] text-[#8a8f98] hover:text-[#ededed] transition-colors text-xs"
				>
					<FolderPlus size={13} />
					New Folder
				</button>
				<button
					onClick={() => navigate(`/${encodeURIComponent(activeWorkspaceId)}/settings`)}
					className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md bg-[#050505] border border-[#1f1f1f] text-[#8a8f98] hover:text-[#ededed] transition-colors text-xs"
				>
					<Settings2 size={13} />
					Manage
				</button>
			</div>
		</Menu>
	);
}
