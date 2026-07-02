import type { RecurringAgent } from "@runtime-contract";
import { RecurringRunList } from "./RecurringRunList";

interface RecurringAgentOverviewProps {
	agent: RecurringAgent;
	onSelectRun: (streamId: string) => void;
}

export function RecurringAgentOverview({ agent, onSelectRun }: RecurringAgentOverviewProps) {
	return (
		<div className="flex flex-1 min-h-0 overflow-hidden">
			<div className="flex-1 min-w-0 overflow-y-auto p-6">
				<p className="text-sm font-medium text-whip-muted leading-[1.45] whitespace-pre-wrap">
					{agent.instructions.trim() || "No instructions."}
				</p>
			</div>
			<RecurringRunList runs={agent.recentRuns} activeStreamId={null} onSelect={onSelectRun} />
		</div>
	);
}
