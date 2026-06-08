import { Select, SelectOption } from "@geckoui/geckoui";
import { AGENT_BINARY_OPTIONS, type RuntimeAgentId } from "@runtime-contract";
import { AlertTriangle } from "lucide-react";
import { useRead } from "@/runtime/api-client";

// Agent binary picker that flags binaries whose CLI isn't installed on the host.
// Unavailable options carry a warning icon, and a missing selected binary shows an
// inline alert below the select. Used by the workflow model-tier editor and the
// assistant agent/model setting. Selection stays allowed — a saved config may
// reference a binary the user installs later.
export function AgentBinarySelect({
	value,
	onChange,
	floatingStrategy,
	menuClassName,
}: {
	value: RuntimeAgentId;
	onChange: (v: RuntimeAgentId) => void;
	floatingStrategy?: "fixed" | "absolute";
	menuClassName?: string;
}) {
	const available = useRead((api) => api("agents/available").GET());
	// Until the list loads, treat everything as available to avoid a false alarm.
	const availableIds = new Set((available.data ?? []).map((a) => a.id));
	const isMissing = (id: RuntimeAgentId) => available.data != null && !availableIds.has(id);

	return (
		<div className="flex flex-col gap-1">
			<Select
				value={value}
				floatingStrategy={floatingStrategy}
				menuClassName={menuClassName}
				onChange={(v) => onChange(v as RuntimeAgentId)}
			>
				{AGENT_BINARY_OPTIONS.map((o) => (
					<SelectOption key={o.value} value={o.value} label={o.label}>
						<span className="flex items-center gap-1.5 w-full">
							<span className={isMissing(o.value) ? "text-[#8888a0]" : ""}>{o.label}</span>
							{isMissing(o.value) && <AlertTriangle size={11} className="text-amber-500 ml-auto shrink-0" />}
						</span>
					</SelectOption>
				))}
			</Select>
			{isMissing(value) && (
				<span className="flex items-center gap-1 text-[10px] text-amber-400">
					<AlertTriangle size={11} className="shrink-0" />
					Not installed — this agent won't run.
				</span>
			)}
		</div>
	);
}
