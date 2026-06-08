import { Select, SelectOption } from "@geckoui/geckoui";
import { type AgentModelChoice, EFFORT_OPTIONS, type EffortLevel } from "@runtime-contract";
import { AgentBinarySelect } from "@/components/AgentBinarySelect";
import { ModelSelect } from "@/pages/settings/workflows/ModelSelect";

// Shared agent binary + model + effort picker. Used by recurring agents and the
// assistant settings — a single fixed model choice (no tier/level resolution).
export function AgentModelPicker({
	value,
	onChange,
	floatingStrategy,
	menuClassName,
}: {
	value: AgentModelChoice;
	onChange: (next: AgentModelChoice) => void;
	floatingStrategy?: "fixed" | "absolute";
	menuClassName?: string;
}) {
	const agentId = value.agentId ?? "claude";

	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-start">
			<div className="w-full sm:w-32 shrink-0">
				<AgentBinarySelect
					value={agentId}
					floatingStrategy={floatingStrategy}
					menuClassName={menuClassName}
					// Models differ per binary, so reset the model when the agent changes.
					onChange={(v) => onChange({ ...value, agentId: v, model: null })}
				/>
			</div>
			<div className="flex-1 min-w-0">
				<ModelSelect
					agentId={agentId}
					value={value.model ?? ""}
					onChange={(v) => onChange({ ...value, model: v || null })}
					floatingStrategy={floatingStrategy}
					menuClassName={menuClassName}
				/>
			</div>
			<div className="w-full sm:w-36 shrink-0">
				<Select
					value={value.effort ?? ""}
					floatingStrategy={floatingStrategy}
					menuClassName={menuClassName}
					onChange={(v) => onChange({ ...value, effort: (v || null) as EffortLevel | null })}
				>
					<SelectOption value="" label="Default effort" />
					{EFFORT_OPTIONS.map((o) => (
						<SelectOption key={o.value} value={o.value} label={o.label} />
					))}
				</Select>
			</div>
		</div>
	);
}
