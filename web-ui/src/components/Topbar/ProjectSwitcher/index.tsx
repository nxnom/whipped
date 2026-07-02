import { Menu, MenuTrigger, useMenu } from "@geckoui/geckoui";
import type { RuntimeProject } from "@runtime-contract";
import { ChevronDown, FolderOpen, FolderPlus, Plus, Search } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { type ProjectsSidebarHandle, ProjectsSidebar } from "@/components/ProjectsSidebar";

interface ProjectListProps {
	sidebarRef: RefObject<ProjectsSidebarHandle>;
	projects: RuntimeProject[];
	activeWorkspaceId: string;
	onSwitch: (workspaceId: string) => void;
	onRemove: (workspaceId: string) => Promise<void>;
}

// Closes the dropdown as soon as a project is picked — must live inside <Menu> to reach its context.
function ProjectList({ sidebarRef, projects, activeWorkspaceId, onSwitch, onRemove }: ProjectListProps) {
	const { closeMenu } = useMenu();

	const handleSwitch = (workspaceId: string) => {
		onSwitch(workspaceId);
		closeMenu();
	};

	return (
		<div className="max-h-[320px] overflow-y-auto -mx-1">
			<ProjectsSidebar
				ref={sidebarRef}
				projects={projects}
				activeWorkspaceId={activeWorkspaceId}
				onSwitch={handleSwitch}
				onRemove={onRemove}
			/>
		</div>
	);
}

// Also lives inside <Menu> so "New Project" can close the dropdown before opening the dialog.
function Footer({
	sidebarRef,
	onAddProject,
}: {
	sidebarRef: RefObject<ProjectsSidebarHandle>;
	onAddProject: () => void;
}) {
	const { closeMenu } = useMenu();

	return (
		<div className="flex items-center gap-2 pt-2 border-t border-whip-border-soft">
			<button
				onClick={() => sidebarRef.current?.addFolder()}
				className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md bg-whip-bg border border-whip-border-soft text-whip-muted hover:text-whip-text transition-colors text-xs"
			>
				<FolderPlus size={13} />
				New Folder
			</button>
			<button
				onClick={() => {
					closeMenu();
					onAddProject();
				}}
				className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md bg-whip-accent hover:opacity-85 transition-opacity text-xs font-bold text-whip-accent-text"
			>
				<Plus size={13} />
				New Project
			</button>
		</div>
	);
}

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
	const [search, setSearch] = useState("");
	const sidebarRef = useRef<ProjectsSidebarHandle>(null);

	const keyword = search.trim().toLowerCase();
	const filtered = keyword ? projects.filter((p) => p.name.toLowerCase().includes(keyword)) : projects;

	return (
		<Menu
			placement="bottom-start"
			menuClassName="w-[336px] p-2 flex flex-col gap-1.5 bg-whip-panel border border-whip-border rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
		>
			<MenuTrigger>
				{({ toggleMenu }) => (
					<button
						onClick={toggleMenu}
						className="flex items-center gap-2.5 h-[38px] px-3 rounded-md bg-whip-panel border border-whip-border hover:border-whip-border-hover transition-colors min-w-[220px]"
					>
						<FolderOpen size={16} className="text-whip-muted shrink-0" />
						<div className="flex-1 min-w-0 text-left">
							<p className="text-[10px] font-medium text-whip-faint leading-none">Personal</p>
							<p className="text-[13px] font-semibold text-whip-text truncate leading-tight mt-0.5">
								{activeProject?.name ?? "Select project"}
							</p>
						</div>
						<ChevronDown size={14} className="text-whip-muted shrink-0" />
					</button>
				)}
			</MenuTrigger>

			<div className="flex items-center gap-2 h-[34px] px-2.5 rounded-md bg-whip-bg border border-whip-border-soft">
				<Search size={14} className="text-whip-faint shrink-0" />
				<input
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Find project..."
					className="flex-1 min-w-0 bg-transparent outline-none text-xs text-whip-text placeholder:text-whip-faint"
				/>
			</div>

			<ProjectList
				sidebarRef={sidebarRef}
				projects={filtered}
				activeWorkspaceId={activeWorkspaceId}
				onSwitch={onSwitch}
				onRemove={onRemove}
			/>

			<Footer sidebarRef={sidebarRef} onAddProject={onAddProject} />
		</Menu>
	);
}
