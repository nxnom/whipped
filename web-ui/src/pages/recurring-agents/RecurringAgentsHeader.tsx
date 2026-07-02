import { Button } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { Plus } from "lucide-react";
import { classNames } from "@/utils/classNames";

interface RecurringAgentsHeaderProps {
	agents: RecurringAgent[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	onNewAgent: () => void;
}

export function RecurringAgentsHeader({ agents, selectedId, onSelect, onNewAgent }: RecurringAgentsHeaderProps) {
	return (
		<div className="shrink-0 border-b border-whip-border-soft bg-whip-bg px-8 py-5">
			<div className="flex items-start gap-4">
				<div className="flex-1 min-w-0">
					<h1 className="text-[26px] font-bold text-whip-text">Recurring Agents</h1>
					<p className="mt-1.5 text-sm font-medium text-whip-muted">
						Scheduled read-only observers that create cards, keep a journal, and preserve terminal history.
					</p>
				</div>
				<Button variant="filled" color="primary" onClick={onNewAgent} className="shrink-0">
					<Plus size={16} />
					New Agent
				</Button>
			</div>

			{agents.length > 0 && (
				<div className="mt-5 flex items-center gap-2.5 overflow-x-auto">
					{agents.map((agent) => (
						<AgentPill
							key={agent.id}
							agent={agent}
							active={agent.id === selectedId}
							onClick={() => onSelect(agent.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function AgentPill({ agent, active, onClick }: { agent: RecurringAgent; active: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={classNames(
				"flex items-center gap-2.5 shrink-0 h-[34px] rounded-full border px-3.5 transition-colors",
				active
					? "bg-whip-panel border-whip-accent"
					: "bg-transparent border-whip-border hover:border-whip-border-hover",
			)}
		>
			<span className={classNames("size-2 rounded-full shrink-0", agent.enabled ? "bg-[#22c55e]" : "bg-whip-muted")} />
			<span className={classNames("text-[13px] font-bold", active ? "text-whip-text" : "text-whip-muted")}>
				{agent.name}
			</span>
			<span className="text-[11px] font-bold text-whip-faint">{agent.enabled ? "Enabled" : "Disabled"}</span>
		</button>
	);
}
