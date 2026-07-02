import type { RecurringAgent } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import { formatDuration, formatRelative, formatSchedule, formatTimestamp } from "./helpers";
import { StatusIcon } from "./RecurringRunList";

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-2 text-[13px]">
			<span className="font-semibold text-whip-muted">{label}</span>
			<div className="flex-1" />
			<span className="font-bold text-whip-text">{value}</span>
		</div>
	);
}

interface RecurringAgentOverviewProps {
	agent: RecurringAgent;
	modelLabel: string;
	onSelectRun: (streamId: string) => void;
}

export function RecurringAgentOverview({ agent, modelLabel, onSelectRun }: RecurringAgentOverviewProps) {
	const finishedRuns = agent.recentRuns.filter((r) => r.status !== "running");
	const okRuns = finishedRuns.filter((r) => r.status === "ok").length;
	const successRate = finishedRuns.length ? Math.round((okRuns / finishedRuns.length) * 100) : null;

	return (
		<div className="flex flex-1 min-h-0 gap-[18px] p-6 overflow-y-auto">
			{/* Instructions */}
			<div className="flex-1 min-w-0 flex flex-col gap-[18px] rounded-lg border border-whip-border bg-whip-surface p-[22px]">
				<span className="text-base font-bold text-whip-text">Instructions</span>
				<p className="text-sm font-medium text-whip-muted leading-[1.45] whitespace-pre-wrap">
					{agent.instructions.trim() || "No instructions."}
				</p>
			</div>

			{/* Right rail */}
			<div className="w-[360px] shrink-0 flex flex-col gap-3.5">
				<div className="flex flex-col gap-2.5 rounded-lg border border-whip-border bg-whip-surface p-[18px]">
					<span className="text-[15px] font-bold text-whip-text">Agent details</span>
					<DetailRow label="Schedule" value={formatSchedule(agent.schedule)} />
					<DetailRow label="Model" value={modelLabel} />
					<DetailRow label="Next run" value={agent.enabled ? formatRelative(agent.nextRunAt) : "—"} />
					<DetailRow label="Runs" value={String(agent.recentRuns.length)} />
					<DetailRow label="Success" value={successRate !== null ? `${successRate}%` : "—"} />
				</div>

				<div className="flex-1 min-h-0 flex flex-col gap-2 rounded-lg border border-whip-border bg-whip-surface p-3.5 overflow-hidden">
					<span className="text-[15px] font-bold text-whip-text px-0.5">Recent runs</span>
					<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
						{agent.recentRuns.length === 0 ? (
							<p className="px-1 py-3 text-[11px] text-whip-faint">No runs yet.</p>
						) : (
							agent.recentRuns.map((run) => {
								const duration = formatDuration(run.startedAt, run.endedAt);
								return (
									<button
										key={run.id}
										onClick={() => run.streamId && onSelectRun(run.streamId)}
										disabled={!run.streamId}
										className={classNames(
											"w-full flex items-start gap-2.5 rounded px-1.5 py-2 text-left transition-colors hover:bg-white/[0.03]",
											!run.streamId && "cursor-default",
										)}
									>
										<div className="mt-0.5 shrink-0">
											<StatusIcon status={run.status} />
										</div>
										<div className="flex-1 min-w-0 flex flex-col gap-0.5">
											<span className="text-[13px] font-bold text-whip-text truncate">
												{formatTimestamp(run.startedAt)}
											</span>
											<span className="text-[11px] font-semibold text-whip-faint flex items-center gap-1.5">
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
		</div>
	);
}
