import type { RuntimeAgentId } from "@runtime-contract";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { ModelSelect } from "@/pages/settings/workflows/ModelSelect";

// RHF-bound model picker. Watches the agent field to know which presets to show,
// and stores the chosen model on `name` (null = agent default).
export function RHFModelSelect({
	name,
	agentName,
	floatingStrategy,
	menuClassName,
}: {
	name: string;
	agentName: string;
	floatingStrategy?: "fixed" | "absolute";
	menuClassName?: string;
}) {
	const { control } = useFormContext();
	const agentId = (useWatch({ control, name: agentName }) ?? "claude") as RuntimeAgentId;
	const { field } = useController({ name, control });

	return (
		<ModelSelect
			agentId={agentId}
			value={field.value ?? ""}
			onChange={(v) => field.onChange(v || null)}
			floatingStrategy={floatingStrategy}
			menuClassName={menuClassName}
		/>
	);
}
