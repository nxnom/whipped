import { Switch, Tooltip } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { BookText, Clock, Cpu, FileText, Loader2, Pencil, Play, Save, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { formatDuration, formatRelative, formatSchedule, formatTimestamp } from "./helpers";
import { RecurringRunList, StatusIcon } from "./RecurringRunList";

type DetailTab = "overview" | "journal" | "terminal";

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<span className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-whip-muted bg-whip-panel border border-whip-border">
			{icon}
			{children}
		</span>
	);
}

function StatRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-2 text-[12px]">
			<span className="text-whip-faint">{label}</span>
			<span className="text-whip-text">{value}</span>
		</div>
	);
}

export function RecurringAgentDetail({
	agent,
	workspaceId,
	running,
	savingJournal,
	onToggleEnabled,
	onRunNow,
	onEdit,
	onDelete,
	onSaveJournal,
}: {
	agent: RecurringAgent;
	workspaceId: string;
	running: boolean;
	savingJournal: boolean;
	onToggleEnabled: (enabled: boolean) => void;
	onRunNow: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onSaveJournal: (journal: string) => void;
}) {
	const [tab, setTab] = useState<DetailTab>("overview");
	const [journal, setJournal] = useState(agent.journal);
	// recentRuns is newest-first, so [0] is the latest run.
	const latestStreamId = agent.recentRuns[0]?.streamId ?? null;
	const [activeStreamId, setActiveStreamId] = useState<string | null>(latestStreamId);

	// Reseed local state only when switching agents, so background polls don't clobber edits.
	const loadedId = useRef(agent.id);
	useEffect(() => {
		if (loadedId.current !== agent.id) {
			loadedId.current = agent.id;
			setJournal(agent.journal);
			setTab("overview");
		}
	}, [agent.id, agent.journal]);

	// Auto-follow the latest run (and follow agent switches, since the latest changes).
	useEffect(() => {
		setActiveStreamId(latestStreamId);
	}, [latestStreamId]);

	const modelLabel = [agent.model.agentId, agent.model.model, agent.model.effort].filter(Boolean).join(" · ");
	const isRunning = agent.recentRuns.some((r) => r.status === "running");
	const finishedRuns = agent.recentRuns.filter((r) => r.status !== "running");
	const okRuns = finishedRuns.filter((r) => r.status === "ok").length;
	const successRate = finishedRuns.length ? Math.round((okRuns / finishedRuns.length) * 100) : null;

	const handleRunNow = () => {
		onRunNow();
		setTab("terminal");
	};

	const tabs = [
		{ id: "overview" as DetailTab, label: "Overview", Icon: FileText },
		{ id: "journal" as DetailTab, label: "Journal", Icon: BookText },
		{
			id: "terminal" as DetailTab,
			label: `Terminal${agent.recentRuns.length ? ` (${agent.recentRuns.length})` : ""}`,
			Icon: TerminalSquare,
		},
	];

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-3 px-6 py-2.5 border-b border-whip-border bg-whip-bg shrink-0">
				<span className="text-[13px] font-semibold text-whip-text truncate">{agent.name}</span>
				<div className="flex-1" />
				<label className="flex items-center gap-1.5">
					<Switch size="sm" checked={agent.enabled} onChange={onToggleEnabled} />
					<span className="text-[11px] text-whip-muted">{agent.enabled ? "Enabled" : "Disabled"}</span>
				</label>
				<div className="w-px h-[18px] bg-whip-border shrink-0" />
				<Tooltip delayDuration={0} content={running ? "Starting..." : "Run now"} side="bottom" triggerAsChild>
					<button
						onClick={handleRunNow}
						disabled={running}
						className="cursor-pointer text-whip-faint hover:text-[#22c55e] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Play size={15} />
					</button>
				</Tooltip>
				<Tooltip delayDuration={0} content="Edit" side="bottom" triggerAsChild>
					<button onClick={onEdit} className="cursor-pointer text-whip-faint hover:text-whip-text transition-colors">
						<Pencil size={15} />
					</button>
				</Tooltip>
				<div className="w-px h-[18px] bg-whip-border shrink-0" />
				<Tooltip delayDuration={0} content="Delete agent" side="bottom" triggerAsChild>
					<button onClick={onDelete} className="cursor-pointer text-whip-faint hover:text-[#ff3b4d] transition-colors">
						<Trash2 size={15} />
					</button>
				</Tooltip>
			</div>

			{/* Sub-header badges */}
			<div className="flex items-center gap-2 px-6 py-2 border-b border-whip-border bg-whip-bg shrink-0 flex-wrap">
				<Badge icon={<Clock size={11} />}>{formatSchedule(agent.schedule)}</Badge>
				<Badge icon={<Cpu size={11} />}>{modelLabel}</Badge>
				<div className="flex-1" />
				{isRunning ? (
					<span className="flex items-center gap-1.5 text-[11px] font-medium text-whip-text">
						<span className="size-[7px] rounded-full bg-whip-text animate-pulse" /> Running
					</span>
				) : (
					agent.enabled &&
					agent.nextRunAt && <span className="text-[11px] text-whip-faint">Next {formatRelative(agent.nextRunAt)}</span>
				)}
			</div>

			{/* Tab bar */}
			<div className="flex shrink-0 bg-whip-bg border-b border-whip-border px-5">
				{tabs.map(({ id, label, Icon }) => (
					<button
						key={id}
						onClick={() => setTab(id)}
						className={classNames(
							"relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors",
							tab === id ? "text-whip-text" : "text-whip-faint hover:text-whip-muted",
						)}
					>
						<Icon size={11} />
						{label}
						{tab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-whip-accent" />}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
				{tab === "overview" && (
					<div className="flex flex-1 min-h-0">
						{/* Instructions — plain text, no card */}
						<div className="flex-1 min-w-0 overflow-y-auto px-6 pt-5">
							<span className="text-[13px] font-medium text-whip-text">Instructions</span>
							<p className="mt-2 text-[13px] text-whip-muted whitespace-pre-wrap leading-relaxed">
								{agent.instructions.trim() || "No instructions."}
							</p>
						</div>

						{/* Activity — same style as the Terminal run sidebar */}
						<div className="w-64 shrink-0 bg-whip-bg border-l border-whip-border flex flex-col overflow-hidden">
							<div className="px-4 py-3 border-b border-whip-border shrink-0">
								<span className="text-xs font-semibold text-whip-muted">Activity</span>
							</div>
							<div className="px-4 py-3 flex flex-col gap-2 border-b border-whip-border shrink-0">
								<StatRow label="Next run" value={agent.enabled ? formatRelative(agent.nextRunAt) : "—"} />
								<StatRow label="Last run" value={agent.lastRunAt ? formatRelative(agent.lastRunAt) : "Never"} />
								<StatRow label="Runs" value={String(agent.recentRuns.length)} />
								<StatRow label="Success" value={successRate !== null ? `${successRate}%` : "—"} />
							</div>
							<div className="flex-1 overflow-y-auto px-2 py-2">
								{agent.recentRuns.length === 0 ? (
									<p className="px-2 py-3 text-[11px] text-whip-faint">No runs yet.</p>
								) : (
									agent.recentRuns.map((run) => {
										const duration = formatDuration(run.startedAt, run.endedAt);
										return (
											<button
												key={run.id}
												onClick={() => {
													if (!run.streamId) return;
													setActiveStreamId(run.streamId);
													setTab("terminal");
												}}
												disabled={!run.streamId}
												className={classNames(
													"w-full flex items-start gap-2 rounded px-1.5 py-2 text-left transition-colors hover:bg-white/[0.03]",
													!run.streamId && "cursor-default",
												)}
											>
												<div className="mt-0.5 shrink-0">
													<StatusIcon status={run.status} />
												</div>
												<div className="flex-1 min-w-0 flex flex-col gap-0.5">
													<span className="text-[12px] text-whip-text truncate">{formatTimestamp(run.startedAt)}</span>
													<span className="text-[10px] text-whip-faint flex items-center gap-1.5">
														{run.trigger === "manual" ? "Manual" : "Scheduled"}
														{duration && (
															<>
																<span>·</span>
																<span className="font-mono">{duration}</span>
															</>
														)}
													</span>
												</div>
											</button>
										);
									})
								)}
							</div>
						</div>
					</div>
				)}

				{tab === "journal" && (
					<div className="flex-1 min-h-0 flex flex-col px-6 py-5 gap-3">
						<div className="flex items-center gap-2 shrink-0">
							<span className="text-[11px] text-whip-faint flex-1">
								The agent's notes, carried across runs. It rewrites this each run; you can edit it too.
							</span>
							<Tooltip delayDuration={0} content="Save journal" side="bottom" triggerAsChild>
								<button
									type="button"
									onClick={() => onSaveJournal(journal)}
									disabled={savingJournal || journal === agent.journal}
									className="shrink-0 text-whip-faint hover:text-whip-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
								>
									{savingJournal ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
								</button>
							</Tooltip>
						</div>
						<textarea
							value={journal}
							onChange={(e) => setJournal(e.target.value)}
							className="flex-1 min-h-0 w-full resize-none rounded-lg bg-whip-bg border border-whip-border px-3.5 py-3 text-[13px] text-whip-text placeholder:text-whip-faint outline-none focus:border-whip-border-hover leading-relaxed"
						/>
					</div>
				)}

				{tab === "terminal" &&
					(agent.recentRuns.length === 0 ? (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-whip-faint">
							<TerminalSquare size={28} />
							<p className="text-sm">No runs yet</p>
							<p className="text-xs">Hit Run now to watch the agent's terminal output here</p>
						</div>
					) : (
						<div className="flex flex-1 min-h-0">
							<div className="flex-1 min-w-0">
								{activeStreamId && (
									<TaskTerminal
										key={activeStreamId}
										taskId={activeStreamId}
										workspaceId={workspaceId}
										className="h-full"
									/>
								)}
							</div>
							<RecurringRunList runs={agent.recentRuns} activeStreamId={activeStreamId} onSelect={setActiveStreamId} />
						</div>
					))}
			</div>
		</div>
	);
}
