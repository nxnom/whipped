import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { GitBranch, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspaceState } from "@/stores/board-store";
import { useRunSession } from "@/stores/run-session-store";
import { CompanionBar } from "./CompanionBar";
import { CompanionSessionDetail } from "./CompanionSessionDetail";
import { CompanionSessionTable } from "./CompanionSessionTable";
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

	const { list, stop, discard, resume } = useCompanionSessions(wsId);
	const sessionsLoaded = list.data !== undefined;
	const sessions = list.data ?? [];
	const selected = sessions.find((s) => s.id === sessionId) ?? null;
	const activeSession = sessions
		.filter((s) => s.status === "running" || s.status === "installing")
		.sort((a, b) => b.updatedAt - a.updatedAt)[0];
	// Still figuring out where to land: either the session list hasn't loaded
	// yet, or it has and we're about to redirect to the active one below — in
	// both cases render a loader instead of the "no sessions" empty state so
	// it doesn't flash before the redirect lands.
	const initializing = !sessionsLoaded || (!sessionId && !!activeSession);

	const { session: runSession, startCompanion: startProjectRun, stop: stopProjectRun } = useRunSession(wsId);
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
	// state when something's actually happening. If every session is idle,
	// don't steal focus from one the user would pick deliberately — the empty
	// state below lists them instead.
	useEffect(() => {
		if (sessionId || !activeSession) return;
		navigate(`/${encodeURIComponent(wsId)}/companion/${encodeURIComponent(activeSession.id)}`, { replace: true });
	}, [sessionId, activeSession, wsId, navigate]);

	const handleStop = async () => {
		if (!selected) return;
		const res = await stop.trigger({ params: { id: selected.id }, query: { workspaceId: wsId } });
		if (res.error) {
			toast.error("Failed to stop session");
			return;
		}
		// Refresh before navigating so the auto-redirect effect doesn't see the
		// killed session as still running and bounce back to its dead terminal.
		await list.trigger();
		navigate(`/${encodeURIComponent(wsId)}/companion`, { replace: true });
	};

	const handleResume = async () => {
		if (!selected) return;
		const res = await resume.trigger({ params: { id: selected.id }, body: { workspaceId: wsId } });
		if (res.error) {
			toast.error("Failed to resume session");
			return;
		}
		void list.trigger();
	};

	const handleDiscard = async (session: CompanionSession) => {
		const res = await discard.trigger({ params: { id: session.id }, body: { workspaceId: wsId } });
		if (res.error) {
			toast.error("Failed to discard session");
			return;
		}
		toast.success("Session deleted");
		// Deleting from the table leaves you on the table; only the open session
		// disappearing needs to send you back to the list.
		if (session.id === sessionId) navigate(`/${encodeURIComponent(wsId)}/companion`, { replace: true });
		void list.trigger();
	};

	const confirmDiscard = (session: CompanionSession) => {
		ConfirmDialog.show({
			title: "Delete companion session",
			content: session.useWorktree
				? `Permanently delete "${session.name}"? This removes its worktree and branch — any uncommitted work is lost, and this cannot be undone.`
				: `Permanently delete "${session.name}"? Nothing was created on disk, but this cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				void handleDiscard(session);
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
					{initializing ? (
						<div className="flex-1 flex items-center justify-center">
							<Loader2 size={20} className="animate-spin text-whip-faint" />
						</div>
					) : selected ? (
						<CompanionSessionDetail
							session={selected}
							workspaceId={wsId}
							onStopSession={() => void handleStop()}
							onResumeSession={() => void handleResume()}
							resuming={resume.loading}
						/>
					) : sessions.length > 0 ? (
						<div className="flex-1 min-h-0">
							<CompanionSessionTable
								sessions={sessions}
								onSelect={select}
								onNewSession={() => setDialogOpen(true)}
								onDelete={confirmDiscard}
							/>
						</div>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
							<div className="flex items-center justify-center size-16 rounded-full bg-whip-accent/10 shrink-0">
								<GitBranch size={28} className="text-whip-accent" />
							</div>
							<div className="flex flex-col gap-1 shrink-0">
								<span className="text-[16px] font-semibold text-whip-text">No companion sessions yet</span>
								<span className="text-[13px] text-whip-faint">
									Pair directly with a coding agent in its own isolated worktree.
								</span>
							</div>
							<Button size="sm" onClick={() => setDialogOpen(true)} className="shrink-0">
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
						hasStartCommand={hasStartCommand}
						projectRunActive={runSession.status === "running" && runSession.cardId === selected.id}
						onRunProject={() => void handleRunProject()}
						onStopProjectRun={() => void handleStopProjectRun()}
						canMerge={canMerge}
						onMerge={handleMerge}
						onCreatePR={handleCreatePR}
						onDelete={() => confirmDiscard(selected)}
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
