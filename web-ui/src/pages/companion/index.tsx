import { Button, toast } from "@geckoui/geckoui";
import { ArrowLeft, GitBranch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRead } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import { CompanionSessionDetail } from "./CompanionSessionDetail";
import { CompanionSessionList } from "./CompanionSessionList";
import { CompanionStartDialog } from "./CompanionStartDialog";
import { useCompanionSessions } from "./useCompanionSessions";

const POLL_INTERVAL_MS = 5000;

export function CompanionPage() {
	const navigate = useNavigate();
	const { workspaceId, sessionId } = useParams<{ workspaceId: string; sessionId: string }>();
	const wsId = workspaceId!;

	const { state } = useWorkspaceState(wsId);
	const workflows = state?.projectConfig.workflows ?? [];
	const hasStartCommand = Boolean(state?.projectConfig.startCommand);

	const { data: projectList } = useRead((api) => api("projects").GET());
	const activeProject = (projectList ?? []).find((p) => p.workspaceId === wsId) ?? null;

	const { list, stop, discard } = useCompanionSessions(wsId);
	const sessions = list.data ?? [];
	const selected = sessions.find((s) => s.id === sessionId) ?? null;

	const [dialogOpen, setDialogOpen] = useState(false);

	// Keep session status fresh while the daemon works in the background.
	useEffect(() => {
		const t = setInterval(() => void list.trigger(), POLL_INTERVAL_MS);
		return () => clearInterval(t);
	}, [list.trigger]);

	const select = (id: string) => navigate(`/${encodeURIComponent(wsId)}/companion/${encodeURIComponent(id)}`);

	const handleStop = async () => {
		if (!selected) return;
		const res = await stop.trigger({ params: { id: selected.id }, query: { workspaceId: wsId } });
		if (res.error) toast.error("Failed to stop session");
	};

	const handleDiscard = async () => {
		if (!selected) return;
		const res = await discard.trigger({ params: { id: selected.id }, body: { workspaceId: wsId } });
		if (res.error) {
			toast.error("Failed to discard session");
			return;
		}
		toast.success("Session discarded");
		void list.trigger();
	};

	return (
		<>
			<div className="flex h-full overflow-hidden">
				{/* List rail */}
				<div className="w-[300px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
					<div className="flex items-center gap-2 px-4 py-4 border-b border-[#2a2a35]">
						<button
							type="button"
							onClick={() => navigate(`/${encodeURIComponent(wsId)}/board`)}
							title="Back to board"
							className="hover:opacity-70 transition-opacity"
						>
							<ArrowLeft size={16} className="text-[#8888a0]" />
						</button>
						<div className="flex-1 min-w-0 flex flex-col">
							<span className="text-[14px] font-semibold text-[#f0f0f5] truncate">Companion</span>
							{activeProject && <span className="text-[11px] text-[#60607a] truncate">{activeProject.name}</span>}
						</div>
						<button
							type="button"
							onClick={() => setDialogOpen(true)}
							title="New session"
							className="hover:opacity-70 transition-opacity"
						>
							<Plus size={16} className="text-[#8888a0]" />
						</button>
					</div>
					<div className="flex-1 overflow-y-auto">
						<CompanionSessionList sessions={sessions} selectedId={selected?.id ?? null} onSelect={select} />
					</div>
				</div>

				{/* Detail */}
				<div className="flex-1 overflow-hidden flex flex-col min-h-0">
					{selected ? (
						<CompanionSessionDetail
							session={selected}
							workspaceId={wsId}
							projectName={activeProject?.name}
							hasStartCommand={hasStartCommand}
							onStop={() => void handleStop()}
							onDiscard={() => void handleDiscard()}
							onRefresh={() => void list.trigger()}
						/>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
							<div className="flex items-center justify-center size-16 rounded-full bg-[#7c6aff10]">
								<GitBranch size={28} className="text-[#7c6aff]" />
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-[16px] font-semibold text-[#f0f0f5]">
									{sessions.length ? "Select a session" : "No companion sessions yet"}
								</span>
								<span className="text-[13px] text-[#60607a]">
									Pair directly with a coding agent in its own isolated worktree.
								</span>
							</div>
							<Button size="sm" onClick={() => setDialogOpen(true)}>
								<span className="flex items-center gap-1.5">
									<Plus size={14} /> New session
								</span>
							</Button>
						</div>
					)}
				</div>
			</div>

			{dialogOpen && (
				<CompanionStartDialog
					workspaceId={wsId}
					workflows={workflows}
					onClose={() => setDialogOpen(false)}
					onCreated={select}
				/>
			)}
		</>
	);
}
