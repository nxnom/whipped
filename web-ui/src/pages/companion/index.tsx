import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import { GitBranch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCanvasVersions } from "@/components/canvas/useCanvasVersions";
import { useWorkspaceState } from "@/stores/board-store";
import { useRunSession } from "@/stores/run-session-store";
import { CompanionBar } from "./CompanionBar";
import { CompanionSessionDetail } from "./CompanionSessionDetail";
import { CompanionStartDialog } from "./CompanionStartDialog";
import { useCompanionActions } from "./useCompanionActions";
import { useCompanionSessions } from "./useCompanionSessions";

const POLL_INTERVAL_MS = 5000;

export function CompanionPage() {
	const navigate = useNavigate();
	const { workspaceId, sessionId } = useParams<{ workspaceId: string; sessionId: string }>();
	const wsId = workspaceId!;

	const { state } = useWorkspaceState(wsId);
	const workflows = state?.projectConfig.workflows ?? [];
	const hasStartCommand = Boolean(state?.projectConfig.startCommand);

	const { list, stop, discard } = useCompanionSessions(wsId);
	const sessions = list.data ?? [];
	const selected = sessions.find((s) => s.id === sessionId) ?? null;

	const { session: runSession, startCompanion: startProjectRun, stop: stopProjectRun } = useRunSession(wsId);
	const { canvases } = useCanvasVersions(wsId, selected?.id ?? "");
	const {
		merging: _merging,
		handleMerge,
		handleCreatePR,
	} = useCompanionActions(wsId, selected ?? sessions[0]!, () => void list.trigger());

	const [dialogOpen, setDialogOpen] = useState(false);

	// Keep session status fresh while the daemon works in the background.
	useEffect(() => {
		const t = setInterval(() => void list.trigger(), POLL_INTERVAL_MS);
		return () => clearInterval(t);
	}, [list.trigger]);

	const select = (id: string) => navigate(`/${encodeURIComponent(wsId)}/companion/${encodeURIComponent(id)}`);

	// Landing on the page with no session selected: jump straight to the most
	// recently active one (installing or running) so you don't land on an empty
	// state when something's actually happening. Falls back to nothing selected
	// when every session is idle — never steals focus from an idle session the
	// user explicitly picked.
	useEffect(() => {
		if (sessionId || sessions.length === 0) return;
		const active = sessions
			.filter((s) => s.status === "running" || s.status === "installing")
			.sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (active) navigate(`/${encodeURIComponent(wsId)}/companion/${encodeURIComponent(active.id)}`);
	}, [sessionId, sessions, wsId, navigate]);

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
		toast.success("Session deleted");
		navigate(`/${encodeURIComponent(wsId)}/companion`, { replace: true });
		void list.trigger();
	};

	const confirmDiscard = () => {
		if (!selected) return;
		ConfirmDialog.show({
			title: "Delete companion session",
			content: selected.useWorktree
				? `Permanently delete "${selected.name}"? This removes its worktree and branch — any uncommitted work is lost, and this cannot be undone.`
				: `Permanently delete "${selected.name}"? Nothing was created on disk, but this cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				void handleDiscard();
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleRunProject = async () => {
		if (!selected) return;
		try {
			await startProjectRun(selected.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to start run");
		}
	};

	const handleStopProjectRun = async () => {
		try {
			await stopProjectRun();
		} catch {
			toast.error("Failed to stop");
		}
	};

	const canMerge =
		!!selected &&
		selected.useWorktree &&
		(selected.status === "running" || (selected.status === "stopped" && !!selected.worktreePath));

	return (
		<>
			<div className="flex flex-col h-full overflow-hidden">
				{/* Detail */}
				<div className="flex-1 overflow-hidden flex flex-col min-h-0">
					{selected ? (
						<CompanionSessionDetail session={selected} workspaceId={wsId} />
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
							<div className="flex items-center justify-center size-16 rounded-full bg-whip-accent/10">
								<GitBranch size={28} className="text-whip-accent" />
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-[16px] font-semibold text-whip-text">
									{sessions.length ? "Select a session" : "No companion sessions yet"}
								</span>
								<span className="text-[13px] text-whip-faint">
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

				{selected && (
					<CompanionBar
						session={selected}
						sessions={sessions}
						onSelectSession={select}
						onNewSession={() => setDialogOpen(true)}
						canvasVersion={canvases[0]?.version ?? null}
						hasStartCommand={hasStartCommand}
						projectRunActive={runSession.status === "running" && runSession.cardId === selected.id}
						onRunProject={() => void handleRunProject()}
						onStopProjectRun={() => void handleStopProjectRun()}
						onStopSession={() => void handleStop()}
						canMerge={canMerge}
						onMerge={handleMerge}
						onCreatePR={handleCreatePR}
						onDelete={confirmDiscard}
					/>
				)}
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
