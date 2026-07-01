import { Checkbox, Input, Radio, Textarea } from "@geckoui/geckoui";
import type { QuestionInput } from "@runtime-contract";
import type { PlanAnswers } from "./types";

function titleCase(s: string): string {
	return s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

// The developer isn't blocked from sending without answering a required
// question (see PlanFeedbackComposer) — this just tells them the agent
// considers it important, so a comment-only skip is a deliberate choice.
export function RequiredMark({ required }: { required?: boolean }) {
	if (!required) return null;
	return <span className="text-red-400">*</span>;
}

function SingleChoiceField({
	input,
	value,
	onChange,
}: {
	input: Extract<QuestionInput, { kind: "single_choice" }>;
	value: string | undefined;
	onChange: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{input.label && (
				<span className="text-[12px] font-medium text-gray-300">
					{input.label} <RequiredMark required={input.required} />
				</span>
			)}
			{input.options.map((opt) => (
				<div key={opt.value} className="flex items-start gap-2">
					<Radio
						name={input.name}
						value={opt.value}
						checked={value === opt.value}
						onChange={() => onChange(opt.value)}
					/>
					<span className="flex flex-col cursor-pointer" onClick={() => onChange(opt.value)}>
						<span className="text-[13px] text-gray-200">{opt.label}</span>
						{opt.description && <span className="text-[11px] text-gray-500">{opt.description}</span>}
					</span>
				</div>
			))}
		</div>
	);
}

function MultiChoiceField({
	input,
	value,
	onChange,
}: {
	input: Extract<QuestionInput, { kind: "multi_choice" }>;
	value: string[];
	onChange: (v: string[]) => void;
}) {
	const selected = new Set(value);
	const toggle = (v: string) => {
		const next = new Set(selected);
		next.has(v) ? next.delete(v) : next.add(v);
		onChange([...next]);
	};

	return (
		<div className="flex flex-col gap-1.5">
			{input.label && (
				<span className="text-[12px] font-medium text-gray-300">
					{input.label} <RequiredMark required={input.required} />
				</span>
			)}
			{input.options.map((opt) => (
				<div key={opt.value} className="flex items-start gap-2">
					<Checkbox checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} />
					<span className="flex flex-col cursor-pointer" onClick={() => toggle(opt.value)}>
						<span className="text-[13px] text-gray-200">{opt.label}</span>
						{opt.description && <span className="text-[11px] text-gray-500">{opt.description}</span>}
					</span>
				</div>
			))}
		</div>
	);
}

function TextField({
	input,
	value,
	onChange,
}: {
	input: Extract<QuestionInput, { kind: "text" }>;
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			{input.label && (
				<span className="text-[12px] font-medium text-gray-300">
					{input.label} <RequiredMark required={input.required} />
				</span>
			)}
			{input.multiline ? (
				<Textarea placeholder={input.placeholder} value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
			) : (
				<Input placeholder={input.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
			)}
		</div>
	);
}

function LeafField({
	input,
	answers,
	onAnswer,
}: {
	input: Exclude<QuestionInput, { kind: "composite" }>;
	answers: PlanAnswers;
	onAnswer: (name: string, value: string | string[]) => void;
}) {
	const label = input.label ?? titleCase(input.name);
	switch (input.kind) {
		case "single_choice":
			return (
				<SingleChoiceField
					input={{ ...input, label }}
					value={answers[input.name] as string | undefined}
					onChange={(v) => onAnswer(input.name, v)}
				/>
			);
		case "multi_choice":
			return (
				<MultiChoiceField
					input={{ ...input, label }}
					value={(answers[input.name] as string[] | undefined) ?? []}
					onChange={(v) => onAnswer(input.name, v)}
				/>
			);
		case "text":
			return (
				<TextField
					input={{ ...input, label }}
					value={(answers[input.name] as string | undefined) ?? ""}
					onChange={(v) => onAnswer(input.name, v)}
				/>
			);
	}
}

export function QuestionBlock({
	input,
	answers,
	onAnswer,
}: {
	input: QuestionInput;
	answers: PlanAnswers;
	onAnswer: (name: string, value: string | string[]) => void;
}) {
	if (input.kind === "composite") {
		return (
			<div className="flex flex-col gap-3">
				{input.parts.map((part) => (
					<LeafField key={part.name} input={part} answers={answers} onAnswer={onAnswer} />
				))}
			</div>
		);
	}
	return <LeafField input={input} answers={answers} onAnswer={onAnswer} />;
}
