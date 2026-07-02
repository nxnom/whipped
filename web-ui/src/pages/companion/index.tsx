import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import { GitBranch, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCanvasVersions } from "@/components/canvas/useCanvasVersions";
import { useWorkspaceState } from "@/stores/board-store";
import { useRunSession } from "@/stores/run-session-store";
import { classNames } from "@/utils/classNames";
import { CompanionBar } from "./CompanionBar";
import { CompanionSessionDetail } from "./CompanionSessionDetail";
import { CompanionStartDialog } from "./CompanionStartDialog";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "./constants";
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
					{initializing ? (
						<div className="flex-1 flex items-center justify-center">
							<Loader2 size={20} className="animate-spin text-whip-faint" />
						</div>
					) : selected ? (
						<CompanionSessionDetail session={selected} workspaceId={wsId} />
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6 overflow-y-auto py-8">
							<div className="flex items-center justify-center size-16 rounded-full bg-whip-accent/10 shrink-0">
								<GitBranch size={28} className="text-whip-accent" />
							</div>
							<div className="flex flex-col gap-1 shrink-0">
								<span className="text-[16px] font-semibold text-whip-text">
									{sessions.length ? "Start a new session" : "No companion sessions yet"}
								</span>
								<span className="text-[13px] text-whip-faint">
									Pair directly with a coding agent in its own isolated worktree.
								</span>
							</div>
							<Button size="sm" onClick={() => setDialogOpen(true)} className="shrink-0">
								<span className="flex items-center gap-1.5">
									<Plus size={14} /> New session
								</span>
							</Button>

							{sessions.length > 0 && (
								<div className="shrink-0 w-full max-w-[420px] flex flex-col gap-2 text-left mt-2">
									<span className="text-[11px] font-semibold text-whip-faint px-0.5">Or open a past session</span>
									<div className="flex flex-col gap-1 rounded-lg border border-whip-border bg-whip-surface p-1.5 max-h-[280px] overflow-y-auto">
										{[...sessions]
											.sort((a, b) => b.updatedAt - a.updatedAt)
											.map((s) => (
												<button
													key={s.id}
													onClick={() => select(s.id)}
													className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-whip-panel transition-colors"
												>
													<span className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[s.status])} />
													<span className="flex-1 min-w-0 text-[13px] font-semibold text-whip-text truncate">
														{s.name}
													</span>
													<span className="shrink-0 text-[11px] text-whip-faint">{STATUS_LABEL[s.status]}</span>
												</button>
											))}
									</div>
								</div>
							)}
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
