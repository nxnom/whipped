import type { RecurringAgentRun } from "@runtime-contract";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { formatDuration, formatTimestamp } from "./helpers";

export function StatusIcon({ status }: { status: RecurringAgentRun["status"] }) {
	if (status === "running") return <Loader2 size={14} className="text-whip-text animate-spin" />;
	if (status === "ok") return <CheckCircle2 size={14} className="text-[#22c55e]" />;
	if (status === "error") return <Circle size={14} className="text-[#ff3b4d]" />;
	return <Circle size={14} className="text-[#eab308]" />;
}

// Right-side run/session switcher, mirroring the ticket detail's session list.
export function RecurringRunList({
	runs,
	activeStreamId,
	onSelect,
}: {
	runs: RecurringAgentRun[];
	activeStreamId: string | null;
	onSelect: (streamId: string) => void;
}) {
	return (
		<div className="w-64 shrink-0 bg-whip-surface border-l border-whip-border flex flex-col overflow-hidden">
			<div className="px-4 py-3 border-b border-whip-border shrink-0">
				<span className="text-xs font-semibold text-whip-muted">Runs</span>
			</div>
			<div className="flex-1 overflow-y-auto px-2 py-2">
				{runs.length === 0 ? (
					<p className="px-2 py-3 text-[11px] text-whip-faint">No runs yet.</p>
				) : (
					runs.map((run) => {
						const focused = run.streamId === activeStreamId;
						const duration = formatDuration(run.startedAt, run.endedAt);
						return (
							<button
								key={run.id}
								onClick={() => run.streamId && onSelect(run.streamId)}
								disabled={!run.streamId}
								className={classNames(
									"w-full flex items-stretch gap-2 rounded px-1.5 py-2 text-left transition-colors",
									focused ? "bg-whip-accent/10" : "hover:bg-white/[0.03]",
									!run.streamId && "opacity-50 cursor-default",
								)}
							>
								<div
									className={classNames(
										"w-0.5 shrink-0 rounded-full self-stretch",
										focused ? "bg-whip-accent" : "bg-transparent",
									)}
								/>
								<div className="mt-0.5 shrink-0">
									<StatusIcon status={run.status} />
								</div>
								<div className="flex-1 min-w-0 flex flex-col gap-0.5">
									<span className={classNames("text-[12px] truncate", focused ? "text-whip-accent" : "text-whip-text")}>
										{formatTimestamp(run.startedAt)}
									</span>
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
	);
}
