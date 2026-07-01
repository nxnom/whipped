import { ConfirmDialog, Tooltip } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { Columns2, GitMerge, GitPullRequest, Play, Square, TerminalSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { useRunSession } from "@/stores/run-session-store";
import { classNames } from "@/utils/classNames";
import { CompanionDiffPanel } from "./CompanionDiffPanel";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "./constants";
import { PlanPanel } from "./plan/PlanPanel";
import { useCompanionActions } from "./useCompanionActions";

type DetailTab = "terminal" | "diff";

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<span className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35]">
			{icon}
			{children}
		</span>
	);
}

export function CompanionSessionDetail({
	session,
	workspaceId,
	projectName,
	hasStartCommand,
	onStop,
	onDiscard,
	onRefresh,
}: {
	session: CompanionSession;
	workspaceId: string;
	projectName?: string;
	hasStartCommand: boolean;
	onStop: () => void;
	onDiscard: () => void;
	onRefresh: () => void;
}) {
	const [tab, setTab] = useState<DetailTab>("terminal");
	const { handleMerge, handleCreatePR } = useCompanionActions(workspaceId, session, onRefresh);
	const { session: runSession, startCompanion: startRun, stop: stopRun } = useRunSession(workspaceId);
	const running = session.status === "running";
	const canMerge = session.useWorktree && (running || (session.status === "stopped" && !!session.worktreePath));

	const confirmDiscard = () => {
		ConfirmDialog.show({
			title: "Delete companion session",
			content: session.useWorktree
				? `Permanently delete "${session.name}"? This removes its worktree and branch — any uncommitted work is lost, and this cannot be undone.`
				: `Permanently delete "${session.name}"? Nothing was created on disk, but this cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				onDiscard();
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 px-6 py-2.5 border-b border-[#2a2a35] bg-[#141418] shrink-0">
				{projectName && (
					<>
						<span className="text-xs text-[#60607a]">{projectName}</span>
						<span className="text-xs text-[#2a2a35]">/</span>
					</>
				)}
				<span className="text-[13px] font-semibold text-[#f0f0f5] truncate">{session.name}</span>
				<div className="flex-1" />
				{hasStartCommand && !!session.worktreePath && (
					<>
						{runSession.status === "running" && runSession.cardId === session.id ? (
							<Tooltip delayDuration={0} content="Stop" side="bottom" triggerAsChild>
								<button
									onClick={() => void stopRun()}
									className="cursor-pointer text-[#60607a] hover:text-red-400 transition-colors"
								>
									<Square size={15} className="fill-current" />
								</button>
							</Tooltip>
						) : (
							<Tooltip
								delayDuration={0}
								content={runSession.status === "running" ? "Another run is active" : "Run"}
								side="bottom"
								triggerAsChild
							>
								<button
									onClick={() => void startRun(session.id)}
									disabled={runSession.status === "running"}
									className="cursor-pointer text-[#60607a] hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								>
									<Play size={15} />
								</button>
							</Tooltip>
						)}
					</>
				)}
				{running && (
					<Tooltip delayDuration={0} content="Stop session" side="bottom" triggerAsChild>
						<button onClick={onStop} className="cursor-pointer text-[#60607a] hover:text-[#f0f0f5] transition-colors">
							<Square size={15} />
						</button>
					</Tooltip>
				)}
				{canMerge && (
					<>
						<Tooltip delayDuration={0} content="Merge into base branch" side="bottom" triggerAsChild>
							<button
								onClick={handleMerge}
								className="cursor-pointer text-[#60607a] hover:text-emerald-400 transition-colors"
							>
								<GitMerge size={15} />
							</button>
						</Tooltip>
						<Tooltip delayDuration={0} content="Create PR" side="bottom" triggerAsChild>
							<button
								onClick={handleCreatePR}
								className="cursor-pointer text-[#60607a] hover:text-[#f0f0f5] transition-colors"
							>
								<GitPullRequest size={15} />
							</button>
						</Tooltip>
					</>
				)}
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				<Tooltip delayDuration={0} content="Delete session" side="bottom" triggerAsChild>
					<button
						onClick={confirmDiscard}
						className="cursor-pointer text-[#60607a] hover:text-red-400 transition-colors"
					>
						<Trash2 size={15} />
					</button>
				</Tooltip>
			</div>

			{/* Sub-header badges */}
			<div className="flex items-center gap-2 px-6 py-2 border-b border-[#2a2a35] bg-[#141418] shrink-0 flex-wrap">
				<span className="flex items-center gap-1.5 text-[11px] text-[#8888a0]">
					<span className={classNames("size-1.5 rounded-full", STATUS_DOT_CLASS[session.status])} />
					{STATUS_LABEL[session.status]}
				</span>
				<Badge icon={<GitMerge size={11} />}>
					{session.useWorktree ? `${session.branchName} → ${session.baseRef}` : `main repo (vs ${session.baseRef})`}
				</Badge>
				<Badge icon={<span />}>{[session.agentId, session.model, session.effort].filter(Boolean).join(" · ")}</Badge>
			</div>

			{/* Tab bar */}
			<div className="flex shrink-0 bg-[#0d0d12] border-b border-[#2a2a35] px-5">
				{(
					[
						{ id: "terminal" as const, label: "Terminal", Icon: TerminalSquare },
						{ id: "diff" as const, label: "Diff", Icon: Columns2 },
					] satisfies { id: DetailTab; label: string; Icon: typeof TerminalSquare }[]
				).map(({ id, label, Icon }) => (
					<button
						key={id}
						onClick={() => setTab(id)}
						className={classNames(
							"relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors",
							tab === id ? "text-[#f0f0f5]" : "text-[#4a4a5a] hover:text-[#8888a0]",
						)}
					>
						<Icon size={11} />
						{label}
						{tab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#7c6aff]" />}
					</button>
				))}
			</div>

			{/* Tab content — a companion session is a single persistent terminal stream,
			    keyed by session id, so the terminal always stays mounted underneath the
			    diff tab (unmounting would drop scrollback and require reconnecting). */}
			<div className="flex-1 min-h-0 flex">
				<TaskTerminal
					key={session.id}
					taskId={session.id}
					workspaceId={workspaceId}
					className={classNames("flex-1 min-h-0", tab !== "terminal" && "hidden")}
				/>
				{tab === "terminal" && <PlanPanel sessionId={session.id} workspaceId={workspaceId} />}
				{tab === "diff" && <CompanionDiffPanel sessionId={session.id} />}
			</div>
		</div>
	);
}
