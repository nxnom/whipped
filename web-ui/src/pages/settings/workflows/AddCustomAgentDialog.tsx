import { Button, Input, Select, SelectOption, Textarea } from "@geckoui/geckoui";
import { AGENT_BINARY_OPTIONS, EFFORT_OPTIONS, type EffortLevel, type RuntimeAgentId } from "@runtime-contract";
import { useState } from "react";
import { Field } from "../_shared";
import { ModelSelect } from "./ModelSelect";

export function AddCustomAgentDialog({
	defaultBinary,
	title = "Add Custom Agent",
	onAdd,
	onClose,
}: {
	defaultBinary: RuntimeAgentId;
	title?: string;
	onAdd: (
		name: string,
		binary: RuntimeAgentId,
		model: string | null,
		effort: EffortLevel | null,
		prompt: string,
	) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [binary, setBinary] = useState<RuntimeAgentId>(defaultBinary);
	const [model, setModel] = useState<string>("");
	const [effort, setEffort] = useState<EffortLevel | "">("");
	const [prompt, setPrompt] = useState("");
	const [promptError, setPromptError] = useState("");

	const handleAdd = () => {
		if (!name.trim()) return;
		if (prompt.trim().length < 50) {
			setPromptError("Instructions must be at least 50 characters.");
			return;
		}
		onAdd(name.trim(), binary, model || null, effort || null, prompt);
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5 space-y-4"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-sm font-semibold text-gray-100">{title}</h3>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Name">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Security Review"
							autoFocus
						/>
					</Field>
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
				</div>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Model (optional)">
						<ModelSelect key={binary} agentId={binary} value={model} onChange={setModel} />
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
				<Field label="Instructions (min 50 chars)">
					<Textarea
						value={prompt}
						onChange={(e) => {
							setPrompt(e.target.value);
							if (promptError) setPromptError("");
						}}
						placeholder="Describe what this agent should check or do..."
						maxRows={20}
						autoResize
					/>
					{promptError && <p className="text-xs text-red-400 mt-1">{promptError}</p>}
				</Field>
				<div className="flex gap-2 justify-end">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleAdd} disabled={!name.trim()}>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}
