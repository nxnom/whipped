import { Menu, MenuItem, MenuTrigger, Tooltip } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { Ellipsis, Loader2, Pencil, Play, Power, Save, TerminalSquare, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { RecurringAgentOverview } from "./RecurringAgentOverview";
import { RecurringRunList } from "./RecurringRunList";

type DetailTab = "overview" | "journal" | "terminal";

const TABS: Array<{ id: DetailTab; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "journal", label: "Journal" },
	{ id: "terminal", label: "Terminal" },
];

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
	const description = agent.instructions.trim().split("\n")[0] || "No instructions.";

	const handleRunNow = () => {
		onRunNow();
		setTab("terminal");
	};

	const selectRun = (streamId: string) => {
		setActiveStreamId(streamId);
		setTab("terminal");
	};

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Header */}
			<div className="flex items-center gap-[18px] px-[22px] py-5 border-b border-whip-border-soft bg-whip-surface shrink-0">
				<div className="flex-1 min-w-0 flex flex-col gap-2">
					<div className="flex items-center gap-2.5">
						<span
							className={classNames(
								"size-[9px] rounded-full shrink-0",
								agent.enabled ? "bg-[#22c55e]" : "bg-whip-muted",
							)}
						/>
						<span className="text-[22px] font-bold text-whip-text truncate">{agent.name}</span>
						<span className="shrink-0 rounded-full bg-whip-panel border border-whip-border px-[9px] py-0.5 text-xs font-bold text-whip-muted">
							{agent.enabled ? "Enabled" : "Disabled"}
						</span>
					</div>
					<span className="text-[13px] font-medium text-whip-muted truncate">{description}</span>
				</div>

				<Tooltip delayDuration={0} content={running ? "Starting..." : "Run now"} side="bottom" triggerAsChild>
					<button
						onClick={handleRunNow}
						disabled={running}
						className="flex items-center gap-2 h-[38px] px-3 rounded-md bg-whip-accent text-[13px] font-bold text-whip-accent-text disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-85"
					>
						<Play size={16} />
						Run now
					</button>
				</Tooltip>
				<button
					onClick={onEdit}
					className="flex items-center gap-2 h-[38px] px-3 rounded-md bg-whip-panel border border-whip-border text-[13px] font-bold text-whip-muted hover:text-whip-text transition-colors"
				>
					<Pencil size={16} />
					Edit
				</button>
				<Menu placement="bottom-end">
					<MenuTrigger>
						{({ toggleMenu }) => (
							<button
								onClick={toggleMenu}
								className="flex items-center gap-2 h-[38px] px-3 rounded-md bg-whip-panel border border-whip-border text-[13px] font-bold text-whip-muted hover:text-whip-text transition-colors"
							>
								<Ellipsis size={16} />
								More
							</button>
						)}
					</MenuTrigger>
					<MenuItem onClick={() => onToggleEnabled(!agent.enabled)}>
						<span className="flex items-center gap-1.5">
							<Power size={12} /> {agent.enabled ? "Disable agent" : "Enable agent"}
						</span>
					</MenuItem>
					<MenuItem onClick={onDelete}>
						<span className="flex items-center gap-1.5 text-[#ff3b4d]">
							<Trash2 size={12} /> Delete agent
						</span>
					</MenuItem>
				</Menu>

				{/* Compact tabs */}
				<div className="flex items-center gap-0.5 shrink-0 rounded-lg border border-whip-border bg-whip-bg p-[3px]">
					{TABS.map(({ id, label }) => (
						<button
							key={id}
							onClick={() => setTab(id)}
							className={classNames(
								"h-7 px-3 rounded-[5px] text-xs font-bold transition-colors",
								tab === id ? "bg-whip-panel-2 text-whip-text" : "text-whip-faint hover:text-whip-muted",
							)}
						>
							{label}
							{id === "terminal" && agent.recentRuns.length > 0 ? ` (${agent.recentRuns.length})` : ""}
						</button>
					))}
				</div>
			</div>

			{/* Tab content */}
			<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
				{tab === "overview" && <RecurringAgentOverview agent={agent} modelLabel={modelLabel} onSelectRun={selectRun} />}

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
