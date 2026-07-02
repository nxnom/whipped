import { Tooltip } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { Loader2, Save, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { RecurringAgentOverview } from "./RecurringAgentOverview";
import { RecurringRunList } from "./RecurringRunList";

export type DetailTab = "overview" | "journal" | "terminal";

const TABS: Array<{ id: DetailTab; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "journal", label: "Journal" },
	{ id: "terminal", label: "Terminal" },
];

export function RecurringAgentDetail({
	agent,
	workspaceId,
	tab,
	onTabChange,
	savingJournal,
	onSaveJournal,
}: {
	agent: RecurringAgent;
	workspaceId: string;
	tab: DetailTab;
	onTabChange: (tab: DetailTab) => void;
	savingJournal: boolean;
	onSaveJournal: (journal: string) => void;
}) {
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
		}
	}, [agent.id, agent.journal]);

	// Auto-follow the latest run (and follow agent switches, since the latest changes).
	useEffect(() => {
		setActiveStreamId(latestStreamId);
	}, [latestStreamId]);

	const selectRun = (streamId: string) => {
		setActiveStreamId(streamId);
		onTabChange("terminal");
	};

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Tab bar */}
			<div className="flex shrink-0 bg-whip-bg border-b border-whip-border px-5">
				{TABS.map(({ id, label }) => (
					<button
						key={id}
						onClick={() => onTabChange(id)}
						className={classNames(
							"relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors",
							tab === id ? "text-whip-text" : "text-whip-faint hover:text-whip-muted",
						)}
					>
						{label}
						{id === "terminal" && agent.recentRuns.length > 0 ? ` (${agent.recentRuns.length})` : ""}
						{tab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-whip-accent" />}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
				{tab === "overview" && <RecurringAgentOverview agent={agent} onSelectRun={selectRun} />}

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
