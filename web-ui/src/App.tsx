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

	const noProjectState = (
		<div className="flex-1 flex flex-col items-center justify-center" style={{ gap: 24 }}>
			{/* CPU icon */}
			<div
				className="flex items-center justify-center"
				style={{ width: 80, height: 80, borderRadius: 40, background: "#7c6aff10" }}
			>
				<Cpu size={36} style={{ color: "#7c6aff" }} />
			</div>

			{/* Text block */}
			<div className="flex flex-col items-center" style={{ gap: 8 }}>
				<span className="text-[24px] font-semibold" style={{ color: "#f0f0f5" }}>
					No project open
				</span>
				<span className="text-[14px]" style={{ color: "#60607a" }}>
					Add a repository to start running autonomous AI agents
				</span>
			</div>

			{/* Add Project button */}
			<button
				onClick={() => setShowAddProject(true)}
				className="flex items-center hover:opacity-80 transition-opacity"
				style={{ background: "#7c6aff", borderRadius: 8, padding: "12px 24px", gap: 8 }}
			>
				<Plus size={16} style={{ color: "#ffffff" }} />
				<span className="text-[14px] font-semibold" style={{ color: "#ffffff" }}>
					Add Project
				</span>
			</button>

			{/* Keyboard shortcut hint */}
			<div className="flex items-center" style={{ gap: 6 }}>
				<span className="text-[12px]" style={{ color: "#60607a" }}>
					or press
				</span>
				<div
					style={{
						background: "#1a1a1f",
						border: "1px solid #2a2a35",
						borderRadius: 4,
						padding: "2px 6px",
					}}
				>
					<span style={{ color: "#8888a0", fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>⌘ N</span>
				</div>
			</div>
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
