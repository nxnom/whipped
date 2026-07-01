import { Button, Select, SelectOption, SelectTrigger, toast } from "@geckoui/geckoui";
import { ArrowLeft, ChevronDown, GitBranch, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRead } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import { classNames } from "@/utils/classNames";
import { CompanionSessionDetail } from "./CompanionSessionDetail";
import { CompanionStartDialog } from "./CompanionStartDialog";
import { STATUS_DOT_CLASS } from "./constants";
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

	return (
		<>
			<div className="flex flex-col h-full overflow-hidden">
				{/* Top bar: back nav + project/session breadcrumb (doubles as a session switcher) + new session */}
				<div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2a2a35] bg-[#141418] shrink-0">
					<button
						type="button"
						onClick={() => navigate(`/${encodeURIComponent(wsId)}/board`)}
						title="Back to board"
						className="flex items-center gap-1.5 min-w-0 hover:opacity-70 transition-opacity shrink-0"
					>
						<ArrowLeft size={16} className="text-[#8888a0] shrink-0" />
						{activeProject && (
							<span className="text-[13px] text-[#60607a] truncate max-w-[160px]">{activeProject.name}</span>
						)}
					</button>

					{activeProject && <span className="text-[13px] text-[#3a3a48] shrink-0">/</span>}

					{sessions.length > 0 ? (
						<Select
							value={selected?.id ?? ""}
							onChange={(id) => select(id as string)}
							hideDefaultEmptyUI
							wrapperClassName="w-fit shrink-0"
							menuClassName="w-fit"
						>
							<SelectTrigger>
								{({ toggleMenu, open }) => (
									<button
										type="button"
										onClick={toggleMenu}
										className="flex items-center gap-1.5 min-w-0 hover:opacity-80 transition-opacity"
									>
										<span className="text-[13px] font-semibold text-[#f0f0f5] truncate max-w-[240px]">
											{selected ? selected.name : "Select session"}
										</span>
										<ChevronDown
											size={13}
											className={classNames("text-[#60607a] transition-transform shrink-0", open && "rotate-180")}
										/>
									</button>
								)}
							</SelectTrigger>
							{sessions.map((s) => (
								<SelectOption key={s.id} value={s.id} label={s.name}>
									{() => (
										<div className="flex items-center gap-2 min-w-0">
											<span className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[s.status])} />
											<div className="flex flex-col min-w-0">
												<span className="text-[13px] text-[#f0f0f5] truncate">{s.name}</span>
												<span className="text-[11px] text-[#60607a] truncate font-mono">
													{s.useWorktree ? s.branchName : "main repo"}
												</span>
											</div>
										</div>
									)}
								</SelectOption>
							))}
						</Select>
					) : (
						<span className="text-[13px] font-semibold text-[#f0f0f5] truncate">No sessions</span>
					)}

					<div className="flex-1" />
					<button
						type="button"
						onClick={() => setDialogOpen(true)}
						title="New session"
						className="hover:opacity-70 transition-opacity shrink-0"
					>
						<Plus size={16} className="text-[#8888a0]" />
					</button>
				</div>

				{/* Detail */}
				<div className="flex-1 overflow-hidden flex flex-col min-h-0">
					{selected ? (
						<CompanionSessionDetail
							session={selected}
							workspaceId={wsId}
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
