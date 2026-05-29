import { GeckoUIPortal } from "@geckoui/geckoui";
import { Cpu, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { AssistantPanel } from "@/components/AssistantPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RunBar } from "@/components/RunBar";
import { BoardPage } from "@/pages/Board";
import { SettingsPage } from "@/pages/settings";
import { useRead } from "@/runtime/api-client";
import { firstSortedProjectId } from "@/utils/projects";

function HomeRoute({ onAddProject }: { onAddProject: () => void }) {
	const navigate = useNavigate();
	const [ready, setReady] = useState(false);
	const { data: list, loading: listLoading } = useRead((api) => api("projects").GET());
	const { data: layout, loading: layoutLoading } = useRead((api) => api("projects/layout").GET());

	useEffect(() => {
		if (listLoading || layoutLoading) return;
		const projects = list ?? [];
		if (projects.length > 0) {
			const id = (layout ? firstSortedProjectId(layout, projects) : null) ?? projects[0]!.workspaceId;
			navigate(`/${encodeURIComponent(id)}/board`, { replace: true });
		} else {
			setReady(true);
		}
	}, [list, layout, listLoading, layoutLoading, navigate]);

	if (!ready) return null;

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-6">
			<div className="flex items-center justify-center w-20 h-20 rounded-full bg-[#7c6aff10]">
				<Cpu size={36} className="text-[#7c6aff]" />
			</div>
			<div className="flex flex-col items-center gap-2">
				<span className="text-[24px] font-semibold text-[#f0f0f5]">No project open</span>
				<span className="text-[14px] text-[#60607a]">Add a repository to start running autonomous AI agents</span>
			</div>
			<button
				onClick={onAddProject}
				className="flex items-center gap-2 bg-[#7c6aff] rounded-lg py-3 px-6 hover:opacity-80 transition-opacity"
			>
				<Plus size={16} className="text-white" />
				<span className="text-[14px] font-semibold text-white">Add Project</span>
			</button>
			<div className="flex items-center gap-1.5">
				<span className="text-[12px] text-[#60607a]">or press</span>
				<div className="bg-[#1a1a1f] border border-[#2a2a35] rounded px-1.5 py-0.5">
					<span className="text-[#8888a0] font-mono text-[11px]">⌘ N</span>
				</div>
			</div>
		</div>
	);
}

function NotFoundPage() {
	const navigate = useNavigate();
	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-4">
			<span className="text-[72px] font-bold text-[#2a2a35]">404</span>
			<span className="text-[20px] font-semibold text-[#f0f0f5]">Page not found</span>
			<span className="text-[14px] text-[#60607a]">The page you're looking for doesn't exist.</span>
			<button
				onClick={() => navigate("/", { replace: true })}
				className="mt-2 text-[14px] text-[#7c6aff] hover:underline"
			>
				Go home
			</button>
		</div>
	);
}

export default function App() {
	const navigate = useNavigate();
	const location = useLocation();

	const activeWorkspaceId = location.pathname.split("/").filter(Boolean)[0] ?? null;
	const [agentOpen, setAgentOpen] = useState(false);
	const [showAddProject, setShowAddProject] = useState(false);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "n") {
				e.preventDefault();
				setShowAddProject(true);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	return (
		<>
			<div className="dark flex h-screen bg-[#0f0f10] text-gray-100 overflow-hidden">
				<div className="flex-1 overflow-hidden flex">
					<main className="flex-1 overflow-hidden flex flex-col">
						<div className="flex-1 overflow-hidden flex flex-col min-h-0">
							<ErrorBoundary>
								<Routes>
									<Route
										path="/:workspaceId/board"
										element={<BoardPage onOpenAgent={() => setAgentOpen((v) => !v)} />}
									/>
									<Route
										path="/:workspaceId/board/:cardId"
										element={<BoardPage onOpenAgent={() => setAgentOpen((v) => !v)} />}
									/>
									<Route path="/:workspaceId/settings" element={<SettingsPage />} />
									<Route path="/:workspaceId/settings/:section" element={<SettingsPage />} />
									<Route path="/" element={<HomeRoute onAddProject={() => setShowAddProject(true)} />} />
									<Route path="*" element={<NotFoundPage />} />
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
