import { GeckoUIPortal } from "@geckoui/geckoui";
import { FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AddProjectDialog } from "@/components/AddProjectDialog";
import { AssistantPanel } from "@/components/AssistantPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RunBar } from "@/components/RunBar";
import { BoardPage } from "@/pages/Board";
import { SettingsPage } from "@/pages/settings";

export default function App() {
	const navigate = useNavigate();
	const location = useLocation();

	const activeWorkspaceId = location.pathname.split("/").filter(Boolean)[0] ?? null;
	const [agentOpen, setAgentOpen] = useState(false);
	const [showAddProject, setShowAddProject] = useState(false);

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
