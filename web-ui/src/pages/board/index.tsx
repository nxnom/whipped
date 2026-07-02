import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { KanbanBoard } from "./components/KanbanBoard";
import { UpdateBanner } from "./components/UpdateBanner";
import { useWorkspaceState } from "@/stores/board-store";
import { useRead } from "@/runtime/api-client";
import { firstSortedProjectId } from "@/utils/projects";

export function BoardPage() {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const { state, connected, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId!);

	// Declarative reads — adding/removing a project is a `projects` write, so the
	// list (and layout) auto-invalidate and refetch; no manual reload needed.
	const { data: projectList } = useRead((api) => api("projects").GET());
	const { data: layout } = useRead((api) => api("projects/layout").GET());

	const projects = projectList ?? [];
	const activeProject = projects.find((p) => p.workspaceId === workspaceId) ?? null;

	// Redirect to a valid project whenever the current workspaceId isn't one of them.
	useEffect(() => {
		if (projects.length === 0) return;
		if (projects.some((p) => p.workspaceId === workspaceId)) return;
		const id = (layout ? firstSortedProjectId(layout, projects) : null) ?? projects[0]!.workspaceId;
		navigate(`/${encodeURIComponent(id)}/board`);
	}, [projectList, layout, workspaceId, navigate]);

	return (
		<div className="flex-1 overflow-hidden flex flex-col min-h-0">
			<UpdateBanner />
			{!connected && !state ? (
				<div className="flex-1 flex items-center justify-center flex-col gap-3 text-whip-faint">
					<WifiOff size={32} />
					<p className="text-sm">Connecting to server...</p>
				</div>
			) : !state ? (
				<div className="flex-1 flex items-center justify-center text-whip-faint text-sm">Loading...</div>
			) : (
				<KanbanBoard
					state={state}
					onRefresh={refetch}
					onDeleteCard={optimisticDeleteCard}
					projectName={activeProject?.name}
				/>
			)}
		</div>
	);
}
