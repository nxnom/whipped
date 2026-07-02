import { GeckoUIPortal } from "@geckoui/geckoui";
import { Cpu, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { AssistantPanel } from "@/components/AssistantPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RunBar } from "@/components/RunBar";
import { Topbar } from "@/components/Topbar";
import { BoardPage } from "@/pages/board";
import { CompanionPage } from "@/pages/companion";
import { RecurringAgentsPage } from "@/pages/recurring-agents";
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
			<div className="flex items-center justify-center w-20 h-20 rounded-full bg-whip-accent/10">
				<Cpu size={36} className="text-whip-text" />
			</div>
			<div className="flex flex-col items-center gap-2">
				<span className="text-[24px] font-semibold text-whip-text">No project open</span>
				<span className="text-[14px] text-whip-faint">Add a repository to start running autonomous AI agents</span>
			</div>
			<button
				onClick={onAddProject}
				className="flex items-center gap-2 bg-whip-accent rounded-lg py-3 px-6 hover:opacity-85 transition-opacity"
			>
				<Plus size={16} className="text-whip-accent-text" />
				<span className="text-[14px] font-semibold text-whip-accent-text">Add Project</span>
			</button>
			<div className="flex items-center gap-1.5">
				<span className="text-[12px] text-whip-faint">or press</span>
				<div className="bg-whip-panel border border-whip-border rounded px-1.5 py-0.5">
					<span className="text-whip-muted font-mono text-[11px]">⌘ N</span>
				</div>
			</div>
		</div>
	);
}

function NotFoundPage() {
	const navigate = useNavigate();
	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-4">
			<span className="text-[72px] font-bold text-whip-border">404</span>
			<span className="text-[20px] font-semibold text-whip-text">Page not found</span>
			<span className="text-[14px] text-whip-faint">The page you're looking for doesn't exist.</span>
			<button
				onClick={() => navigate("/", { replace: true })}
				className="mt-2 text-[14px] text-whip-text hover:underline"
			>
				Go home
			</button>
		</div>
	);
}

export default function App() {
	const navigate = useNavigate();
	const location = useLocation();

	const pathSegments = location.pathname.split("/").filter(Boolean);
	const activeWorkspaceId = pathSegments[0] ?? null;
	// Companion and Recurring Agents each have their own bottom bar with session/run
	// controls, so the global one would just duplicate it.
	const section = pathSegments[1];
	const isCompanion = section === "companion";
	const isRecurringAgents = section === "recurring-agents";
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
			<div className="flex flex-col h-screen bg-whip-bg text-whip-text overflow-hidden">
				{activeWorkspaceId && <Topbar workspaceId={activeWorkspaceId} onOpenAgent={() => setAgentOpen((v) => !v)} />}
				<div className="flex-1 overflow-hidden flex">
					<main className="flex-1 overflow-hidden flex flex-col">
						<div className="flex-1 overflow-hidden flex flex-col min-h-0">
							<ErrorBoundary>
								<Routes>
									<Route path="/:workspaceId/board" element={<BoardPage />} />
									<Route path="/:workspaceId/board/:cardId" element={<BoardPage />} />
									<Route path="/:workspaceId/recurring-agents" element={<RecurringAgentsPage />} />
									<Route path="/:workspaceId/recurring-agents/:agentId" element={<RecurringAgentsPage />} />
									<Route path="/:workspaceId/companion" element={<CompanionPage />} />
									<Route path="/:workspaceId/companion/:sessionId" element={<CompanionPage />} />
									<Route path="/:workspaceId/settings" element={<SettingsPage />} />
									<Route path="/:workspaceId/settings/:section" element={<SettingsPage />} />
									<Route path="/" element={<HomeRoute onAddProject={() => setShowAddProject(true)} />} />
									<Route path="*" element={<NotFoundPage />} />
								</Routes>
							</ErrorBoundary>
						</div>
						{activeWorkspaceId && !isRecurringAgents && <RunBar workspaceId={activeWorkspaceId} />}
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
