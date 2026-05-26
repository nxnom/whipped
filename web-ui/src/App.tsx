import { GeckoUIPortal, toast } from "@geckoui/geckoui";
import type { RuntimeProject } from "@runtime-contract";
import { FolderOpen, Plus, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { AssistantPanel } from "@/components/AssistantPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProjectsSidebar } from "@/components/ProjectsSidebar";
import { RunBar } from "@/components/RunBar";
import { BoardPage } from "@/pages/Board";
import { SettingsPage } from "@/pages/settings";
import { trpc } from "@/runtime/trpc-client";

export default function App() {
	const navigate = useNavigate();
	const location = useLocation();

	// Extract workspaceId from path: /:workspaceId/board or /:workspaceId/settings
	const activeWorkspaceId = location.pathname.split("/").filter(Boolean)[0] ?? null;

	const [projects, setProjects] = useState<RuntimeProject[]>([]);
	const [connected, setConnected] = useState(false);
	const [autonomousOn, setAutonomousOn] = useState(false);
	const [showAddProject, setShowAddProject] = useState(false);
	const [agentOpen, setAgentOpen] = useState(false);

	const switchProject = (workspaceId: string) => {
		navigate(`/${encodeURIComponent(workspaceId)}/board`);
	};

	useEffect(() => {
		loadProjects();
	}, []);

	const loadProjects = async () => {
		try {
			const list = await trpc.projects.list.query();
			setProjects(list);
			if (list.length > 0) {
				const valid = list.some((p) => p.workspaceId === activeWorkspaceId);
				if (!valid) navigate(`/${encodeURIComponent(list[0]!.workspaceId)}/board`, { replace: true });
			}
		} catch {
			toast.error("Failed to load projects");
		}
	};

	const noProjectState = (
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
	);

	return (
		<>
			<div className="dark flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
				{/* Sidebar — projects list */}
				<nav className="w-52 shrink-0 border-r border-gray-800 flex flex-col">
					{/* App branding */}
					<div className="px-4 py-3.5 border-b border-gray-800 shrink-0">
						<span className="text-sm font-bold text-white tracking-tight">Overemployed</span>
					</div>

					{/* Projects list — scrollable */}
					<div className="flex-1 overflow-y-auto py-2">
						<ProjectsSidebar projects={projects} activeWorkspaceId={activeWorkspaceId} onSwitch={switchProject} />
						{projects.length === 0 && <p className="px-4 py-2 text-xs text-gray-600">No projects yet</p>}
					</div>

					{/* Add project */}
					<div className="border-t border-gray-800 shrink-0">
						<button
							onClick={() => setShowAddProject(true)}
							className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-300 hover:bg-gray-900 transition-colors"
						>
							<Plus size={14} />
							Add project
						</button>
					</div>

					{/* Status */}
					{(connected || autonomousOn) && (
						<div className="border-t border-gray-800 shrink-0 px-4 py-2 flex items-center gap-2">
							{connected ? (
								<Wifi size={11} className="text-emerald-400" />
							) : (
								<WifiOff size={11} className="text-gray-600" />
							)}
							{autonomousOn && (
								<>
									<span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
									<span className="text-xs text-emerald-400">Autonomous</span>
								</>
							)}
						</div>
					)}
				</nav>

				{/* Main + Agent panel */}
				<div className="flex-1 overflow-hidden flex">
					<main className="flex-1 overflow-hidden flex flex-col">
						<div className="flex-1 overflow-hidden flex flex-col min-h-0">
							<ErrorBoundary>
								<Routes>
									<Route
										path="/:workspaceId/board"
										element={
											<BoardPage
												onConnectedChange={setConnected}
												onAutonomousChange={setAutonomousOn}
												onOpenSettings={() => navigate(`/${encodeURIComponent(activeWorkspaceId!)}/settings`)}
												onOpenAgent={() => setAgentOpen((v) => !v)}
											/>
										}
									/>
									<Route
										path="/:workspaceId/board/:cardId"
										element={
											<BoardPage
												onConnectedChange={setConnected}
												onAutonomousChange={setAutonomousOn}
												onOpenSettings={() => navigate(`/${encodeURIComponent(activeWorkspaceId!)}/settings`)}
												onOpenAgent={() => setAgentOpen((v) => !v)}
											/>
										}
									/>
									<Route path="/:workspaceId/settings" element={<SettingsPage />} />
									<Route path="/:workspaceId/settings/:section" element={<SettingsPage />} />
									<Route path="*" element={noProjectState} />
								</Routes>
							</ErrorBoundary>
						</div>
						{activeWorkspaceId && <RunBar workspaceId={activeWorkspaceId} />}
					</main>

					{activeWorkspaceId && (
						<AssistantPanel workspaceId={activeWorkspaceId} open={agentOpen} onClose={() => setAgentOpen(false)} />
					)}
				</div>

				{showAddProject && (
					<AddProjectDialog
						onClose={() => setShowAddProject(false)}
						onAdded={(workspaceId) => {
							loadProjects();
							navigate(`/${encodeURIComponent(workspaceId)}/board`);
							setShowAddProject(false);
						}}
					/>
				)}

				<GeckoUIPortal />
			</div>
		</>
	);
}
