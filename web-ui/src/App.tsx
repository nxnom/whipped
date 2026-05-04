import { GeckoUIPortal, toast } from "@geckoui/geckoui";
import type { RuntimeProject } from "@runtime-contract";
import { Bot, ChevronDown, FolderOpen, History, Kanban, Plus, Settings, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { AgentPage } from "@/pages/AgentPage";
import { BoardPage } from "@/pages/Board";
import { HistoryPage } from "@/pages/History";
import { SettingsPage } from "@/pages/Settings";
import { trpc } from "@/runtime/trpc-client";

export type Page = "board" | "history" | "settings" | "agent";

const NAV_ITEMS: Array<{ id: Page; label: string; icon: React.ReactNode }> = [
	{ id: "board", label: "Board", icon: <Kanban size={16} /> },
	{ id: "agent", label: "Kanban Agent", icon: <Bot size={16} /> },
	{ id: "history", label: "History", icon: <History size={16} /> },
	{ id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

export default function App() {
	const [page, setPage] = useState<Page>("board");
	const [projects, setProjects] = useState<RuntimeProject[]>([]);
	const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);
	const [autonomousOn, setAutonomousOn] = useState(false);
	const [showAddProject, setShowAddProject] = useState(false);
	const [showProjectMenu, setShowProjectMenu] = useState(false);

	useEffect(() => {
		loadProjects();
	}, []);

	const loadProjects = async () => {
		try {
			const list = await trpc.projects.list.query();
			setProjects(list);
			if (list.length > 0 && !activeWorkspaceId) {
				setActiveWorkspaceId(list[0]!.workspaceId);
			}
		} catch {
			toast.error("Failed to load projects");
		}
	};

	const activeProject = projects.find((p) => p.workspaceId === activeWorkspaceId);

	return (
		<>
			<div className="dark flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
				{/* Sidebar */}
				<nav className="w-52 shrink-0 border-r border-gray-800 flex flex-col">
					{/* Project switcher */}
					<div className="border-b border-gray-800">
						<button
							onClick={() => setShowProjectMenu(!showProjectMenu)}
							className="w-full px-3 py-3 flex items-center gap-2 hover:bg-gray-900 transition-colors"
						>
							<FolderOpen size={14} className="text-gray-400 shrink-0" />
							<span className="text-sm font-semibold text-white truncate flex-1 text-left">
								{activeProject?.name ?? "No project"}
							</span>
							<ChevronDown
								size={12}
								className={`text-gray-500 transition-transform ${showProjectMenu ? "rotate-180" : ""}`}
							/>
						</button>

						{showProjectMenu && (
							<div className="border-t border-gray-800 bg-gray-900">
								{projects.map((p) => (
									<button
										key={p.workspaceId}
										onClick={() => {
											setActiveWorkspaceId(p.workspaceId);
											setShowProjectMenu(false);
										}}
										className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center gap-2
											${p.workspaceId === activeWorkspaceId ? "text-white bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"}`}
									>
										<span
											className={`size-1.5 rounded-full shrink-0 ${p.workspaceId === activeWorkspaceId ? "bg-blue-400" : "bg-gray-600"}`}
										/>
										<span className="truncate">{p.name}</span>
									</button>
								))}
								<button
									onClick={() => {
										setShowAddProject(true);
										setShowProjectMenu(false);
									}}
									className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors flex items-center gap-2"
								>
									<Plus size={12} />
									Add project
								</button>
							</div>
						)}

						{/* Connection + autonomous status */}
						<div className="px-3 py-1.5 flex items-center gap-2">
							{connected ? (
								<Wifi size={11} className="text-emerald-400" />
							) : (
								<WifiOff size={11} className="text-gray-500" />
							)}
							{autonomousOn && (
								<>
									<span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
									<span className="text-xs text-emerald-400">Autonomous</span>
								</>
							)}
						</div>
					</div>

					{/* Nav */}
					<div className="flex-1 py-1">
						{NAV_ITEMS.map((item) => (
							<button
								key={item.id}
								onClick={() => setPage(item.id)}
								className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors
									${page === item.id ? "text-white bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"}`}
							>
								{item.icon}
								{item.label}
							</button>
						))}
					</div>
				</nav>

				{/* Main */}
				<main className="flex-1 overflow-hidden flex flex-col">
					{activeWorkspaceId ? (
						<>
							{page === "board" && (
								<BoardPage
									workspaceId={activeWorkspaceId}
									onConnectedChange={setConnected}
									onAutonomousChange={setAutonomousOn}
								/>
							)}
							{page === "agent" && <AgentPage workspaceId={activeWorkspaceId} />}
							{page === "history" && <HistoryPage workspaceId={activeWorkspaceId} />}
							{page === "settings" && <SettingsPage workspaceId={activeWorkspaceId} />}
						</>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
							<FolderOpen size={40} />
							<p className="text-sm">No project open</p>
							<button
								onClick={() => setShowAddProject(true)}
								className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
							>
								<Plus size={14} />
								Add a project
							</button>
						</div>
					)}
				</main>

				{showAddProject && (
					<AddProjectDialog
						onClose={() => setShowAddProject(false)}
						onAdded={(workspaceId) => {
							loadProjects();
							setActiveWorkspaceId(workspaceId);
							setShowAddProject(false);
						}}
					/>
				)}

				<GeckoUIPortal />
			</div>
		</>
	);
}
