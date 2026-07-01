import type { RecurringAgent } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import { formatRelative, formatSchedule } from "./helpers";

export function RecurringAgentList({
	agents,
	selectedId,
	onSelect,
}: {
	agents: RecurringAgent[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (agents.length === 0) {
		return (
			<div className="px-4 py-6 text-[13px] text-[#5f6672]">
				No recurring agents yet. Create one to run a task on a schedule.
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{agents.map((agent) => {
				const active = agent.id === selectedId;
				return (
					<button
						key={agent.id}
						type="button"
						onClick={() => onSelect(agent.id)}
						className={classNames(
							"flex flex-col gap-1 px-4 py-3 text-left border-b border-[#1f1f1f] transition-colors",
							active ? "bg-[#161616]" : "hover:bg-[#111111]",
						)}
					>
						<div className="flex items-center gap-2">
							<span
								className={classNames(
									"size-1.5 rounded-full shrink-0",
									agent.enabled ? "bg-[#22c55e]" : "bg-[#3a3a3a]",
								)}
							/>
							<span className="text-[13px] font-medium text-[#ededed] truncate">{agent.name}</span>
						</div>
						<div className="flex items-center justify-between gap-2 pl-3.5">
							<span className="text-[11px] text-[#5f6672] truncate">{formatSchedule(agent.schedule)}</span>
							{agent.enabled && agent.nextRunAt && (
								<span className="text-[11px] text-[#5f6672] shrink-0">{formatRelative(agent.nextRunAt)}</span>
							)}
						</div>
					</button>
				);
			})}
		</div>
	);
}
