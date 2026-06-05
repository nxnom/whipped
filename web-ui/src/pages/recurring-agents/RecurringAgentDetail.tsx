import { LoadingButton, Switch, Textarea, Tooltip } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { BookText, Clock, Cpu, FileText, Pencil, Play, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { formatRelative, formatSchedule } from "./helpers";
import { RecurringRunList } from "./RecurringRunList";

type DetailTab = "overview" | "journal" | "terminal";

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<span className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[11px] text-[#8888a0] bg-[#1a1a1f] border border-[#2a2a35]">
			{icon}
			{children}
		</span>
	);
}

function MetaItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-[11px] text-[#4a4a5a]">{label}</span>
			<span className="text-[13px] text-[#f0f0f5]">{value}</span>
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
			<div className="flex items-center gap-3 px-6 py-2.5 border-b border-[#2a2a35] bg-[#141418] shrink-0">
				<span className="text-[13px] font-semibold text-[#f0f0f5] truncate">{agent.name}</span>
				<div className="flex-1" />
				<label className="flex items-center gap-1.5">
					<Switch size="sm" checked={agent.enabled} onChange={onToggleEnabled} />
					<span className="text-[11px] text-[#8888a0]">{agent.enabled ? "Enabled" : "Disabled"}</span>
				</label>
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				<Tooltip delayDuration={0} content={running ? "Starting..." : "Run now"} side="bottom" triggerAsChild>
					<button
						onClick={handleRunNow}
						disabled={running}
						className="cursor-pointer text-[#60607a] hover:text-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
					>
						<Play size={15} />
					</button>
				</Tooltip>
				<Tooltip delayDuration={0} content="Edit" side="bottom" triggerAsChild>
					<button onClick={onEdit} className="cursor-pointer text-[#60607a] hover:text-[#f0f0f5] transition-colors">
						<Pencil size={15} />
					</button>
				</Tooltip>
				<div className="w-px h-[18px] bg-[#2a2a35] shrink-0" />
				<Tooltip delayDuration={0} content="Delete agent" side="bottom" triggerAsChild>
					<button onClick={onDelete} className="cursor-pointer text-[#60607a] hover:text-red-400 transition-colors">
						<Trash2 size={15} />
					</button>
				</Tooltip>
			</div>

			{/* Sub-header badges */}
			<div className="flex items-center gap-2 px-6 py-2 border-b border-[#2a2a35] bg-[#141418] shrink-0 flex-wrap">
				<Badge icon={<Clock size={11} />}>{formatSchedule(agent.schedule)}</Badge>
				<Badge icon={<Cpu size={11} />}>{modelLabel}</Badge>
				<div className="flex-1" />
				{isRunning ? (
					<span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-300">
						<span className="size-[7px] rounded-full bg-blue-400 animate-pulse" /> Running
					</span>
				) : (
					agent.enabled &&
					agent.nextRunAt && <span className="text-[11px] text-[#60607a]">Next {formatRelative(agent.nextRunAt)}</span>
				)}
			</div>

			{/* Tab bar */}
			<div className="flex shrink-0 bg-[#0d0d12] border-b border-[#2a2a35] px-5">
				{tabs.map(({ id, label, Icon }) => (
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

			{/* Tab content */}
			<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
				{tab === "overview" && (
					<div className="flex-1 overflow-y-auto">
						<div className="flex flex-col gap-6 px-6 py-5 max-w-3xl">
							<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 p-4 rounded-lg bg-[#111115] border border-[#2a2a35]">
								<MetaItem label="Agent" value={modelLabel} />
								<MetaItem label="Next run" value={agent.enabled ? formatRelative(agent.nextRunAt) : "—"} />
								<MetaItem label="Last run" value={agent.lastRunAt ? formatRelative(agent.lastRunAt) : "Never"} />
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="text-[13px] font-medium text-[#f0f0f5]">Instructions</span>
								{agent.instructions.trim() ? (
									<p className="text-[13px] text-[#8888a0] whitespace-pre-wrap leading-relaxed">{agent.instructions}</p>
								) : (
									<p className="text-[13px] text-[#4a4a5a]">No instructions.</p>
								)}
							</div>
						</div>
					</div>
				)}

				{tab === "journal" && (
					<div className="flex-1 overflow-y-auto">
						<div className="flex flex-col gap-3 px-6 py-5 max-w-3xl">
							<span className="text-[11px] text-[#4a4a5a]">
								The agent's notes, carried across runs. It rewrites this each run; you can edit it too.
							</span>
							<Textarea value={journal} onChange={(e) => setJournal(e.target.value)} rows={14} autoResize />
							<div className="flex justify-end">
								<LoadingButton
									size="xs"
									variant="outlined"
									loading={savingJournal}
									disabled={journal === agent.journal}
									onClick={() => onSaveJournal(journal)}
								>
									Save journal
								</LoadingButton>
							</div>
						</div>
					</div>
				)}

				{tab === "terminal" &&
					(agent.recentRuns.length === 0 ? (
						<div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#4a4a5a]">
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
