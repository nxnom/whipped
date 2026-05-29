import { Button, RHFError, RHFInput, RHFSelect, RHFTextarea, SelectOption } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { AGENT_BINARY_OPTIONS, EFFORT_OPTIONS, type EffortLevel, type RuntimeAgentId } from "@runtime-contract";
import { type AddCustomAgentForm, addCustomAgentSchema } from "@runtime-validation/workflow";
import { Controller, FormProvider, useForm } from "react-hook-form";
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
	const methods = useForm<AddCustomAgentForm, unknown, AddCustomAgentForm>({
		resolver: zodResolver(addCustomAgentSchema),
		values: { name: "", binary: defaultBinary, model: "", effort: "", prompt: "" },
	});
	const { control, handleSubmit, setValue, watch } = methods;
	const binary = watch("binary");

	const onSubmit = (data: AddCustomAgentForm) => {
		onAdd(data.name.trim(), data.binary, data.model || null, data.effort || null, data.prompt);
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5 space-y-4"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-sm font-semibold text-gray-100">{title}</h3>
				<FormProvider {...methods}>
					<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
						<div className="grid grid-cols-2 gap-3">
							<Field label="Name">
								<RHFInput name="name" placeholder="e.g. Security Review" autoFocus />
								<RHFError name="name" className="text-xs text-red-400 mt-1" />
							</Field>
							<Field label="Agent">
								<RHFSelect name="binary" onChange={() => setValue("model", "")}>
									{AGENT_BINARY_OPTIONS.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</Field>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Field label="Model (optional)">
								{/* ModelSelect manages its own preset/custom UI; bridge it to RHF. */}
								<Controller
									control={control}
									name="model"
									render={({ field }) => (
										<ModelSelect key={binary} agentId={binary} value={field.value} onChange={field.onChange} />
									)}
								/>
							</Field>
							<Field label="Effort (optional)">
								<RHFSelect name="effort">
									<SelectOption value="" label="Default" />
									{EFFORT_OPTIONS.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</Field>
						</div>
						<Field label="Instructions (min 50 chars)">
							<RHFTextarea
								name="prompt"
								placeholder="Describe what this agent should check or do..."
								maxRows={20}
								autoResize
							/>
							<RHFError name="prompt" className="text-xs text-red-400 mt-1" />
						</Field>
						<div className="flex gap-2 justify-end">
							<Button type="button" variant="ghost" onClick={onClose}>
								Cancel
							</Button>
							<Button type="submit">Add</Button>
						</div>
					</form>
				</FormProvider>
			</div>
		</div>
	);
}
