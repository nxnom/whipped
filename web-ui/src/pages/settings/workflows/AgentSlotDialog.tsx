import { Button, Select, SelectOption, Textarea } from "@geckoui/geckoui";
import {
	AGENT_BINARY_OPTIONS,
	EFFORT_OPTIONS,
	type EffortLevel,
	type RuntimeAgentId,
	type WorkflowSlot,
} from "@runtime-contract";
import { useState } from "react";
import { Field } from "../_shared";
import { ModelSelect } from "./ModelSelect";

export function AgentSlotDialog({
	slot,
	onSave,
	onClose,
}: {
	slot: WorkflowSlot;
	onSave: (updated: WorkflowSlot) => void;
	onClose: () => void;
}) {
	const [binary, setBinary] = useState<RuntimeAgentId>(slot.agentBinary);
	const [model, setModel] = useState<string>(slot.model ?? "");
	const [effort, setEffort] = useState<EffortLevel | "">(slot.effort ?? "");
	const [prompt, setPrompt] = useState(slot.prompt ?? "");
	const [promptError, setPromptError] = useState("");

	const handleSave = () => {
		if ((slot.type === "custom" || slot.type === "orch") && prompt.trim().length > 0 && prompt.trim().length < 50) {
			setPromptError("Prompt must be at least 50 characters.");
			return;
		}
		setPromptError("");
		onSave({ ...slot, agentBinary: binary, model: model || null, effort: effort || null, prompt });
	};

	const placeholder: Record<string, string> = {
		dev: "e.g. Always use TypeScript strict mode. Follow existing naming conventions.",
		code_review: "e.g. Check all new API routes have auth middleware.",
		qa: "e.g. Always run the full test suite with pnpm test.",
		orch: "e.g. Review all subtask implementations together. Check that they integrate correctly and fulfill the story goal.",
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-sm font-semibold text-gray-100">Edit — {slot.name}</h3>

				<div className="grid grid-cols-2 gap-3">
					<Field label="Agent">
						<Select
							value={binary}
							onChange={(v) => {
								setBinary(v as RuntimeAgentId);
								setModel("");
							}}
						>
							{AGENT_BINARY_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
					<Field label="Effort (optional)">
						<Select value={effort} onChange={(v) => setEffort(v as EffortLevel | "")}>
							<SelectOption value="" label="Default" />
							{EFFORT_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
				</div>

				<Field label="Model (optional)">
					<ModelSelect key={binary} agentId={binary} value={model} onChange={setModel} />
				</Field>

				<Field
					label={`Instructions${slot.type === "custom" || slot.type === "orch" ? " (min 50 chars)" : " (optional)"}`}
				>
					<Textarea
						value={prompt}
						onChange={(e) => {
							setPrompt(e.target.value);
							if (promptError) setPromptError("");
						}}
						placeholder={placeholder[slot.type] ?? "Describe what this agent should check or do..."}
						rows={6}
						className="max-h-64 overflow-y-auto resize-y"
					/>
					{promptError && <p className="text-xs text-red-400 mt-1">{promptError}</p>}
				</Field>

				<div className="flex gap-2 justify-end">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleSave}>Save</Button>
				</div>
			</div>
		</div>
	);
}
