import { RHFNumberInput, RHFSwitch, Select, SelectOption } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_AGENT_MODEL_CHOICE, type RuntimeProjectConfig } from "@runtime-contract";
import { AlertTriangle } from "lucide-react";
import {
	type GeneralAutomationForm,
	type GeneralAutomationFormInput,
	generalAutomationFormSchema,
} from "@runtime-validation/config";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { BranchSelect } from "@/components/BranchSelect";
import { SaveRow } from "../_shared";

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-sm font-semibold text-[#ededed]">{title}</span>
			<div className="flex-1 h-px bg-[#2a2a2a]" />
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[#ededed]">{label}</span>
				<span className="text-[11px] text-[#5f6672]">{description}</span>
			</div>
			{children}
		</div>
	);
}

export function GeneralAutomationSection({
	config,
	branches,
	saving,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	branches: string[];
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	const methods = useForm<GeneralAutomationFormInput, unknown, GeneralAutomationForm>({
		resolver: zodResolver(generalAutomationFormSchema),
		values: {
			autoCommit: config.autoCommit ?? true,
			maxParallelTasks: config.maxParallelTasks,
			maxAutoFixAttempts: config.maxAutoFixAttempts,
			pollingIntervalSeconds: config.pollingIntervalSeconds,
			defaultBaseBranch: config.defaultBaseBranch,
		},
	});
	const { control } = methods;

	// RHF owns the form state; mirror each change back into the parent-owned config
	// so the existing onUpdate contract is preserved (no direct API call here).
	const defaultBaseBranch = useWatch({ control, name: "defaultBaseBranch" }) ?? "";

	const toNum = (v: unknown): number | undefined => {
		if (v === "" || v === null || v === undefined) return undefined;
		const n = Number(v);
		return Number.isNaN(n) ? undefined : n;
	};

	return (
		<FormProvider {...methods}>
			<div className="flex flex-col gap-7">
				{config.deliveryMode === "yolo" && (
					<div className="flex items-start gap-2.5 px-3.5 py-3 rounded-md border border-[#eab308]/40 bg-[#eab308]/10">
						<AlertTriangle size={15} className="text-[#eab308] shrink-0 mt-px" />
						<p className="text-[12px] text-[#eab308]/90 leading-relaxed">
							<span className="font-semibold text-[#eab308]">YOLO mode is on.</span> Tasks that pass review are merged
							straight into the local base branch and pushed — no PR and no human approval. If your local repo is on
							that branch, its working tree will read as behind until you pull.
						</p>
					</div>
				)}

				{/* Automation */}
				<div className="flex flex-col gap-4">
					<SectionDivider title="Automation" />
					<FieldRow label="Delivery mode" description="What happens when a task passes review.">
						{/* Direct control — mirrored into the parent-owned config, not the form. */}
						<div className="w-40">
							<Select
								value={config.deliveryMode ?? "off"}
								onChange={(v) => onUpdate({ ...config, deliveryMode: v as RuntimeProjectConfig["deliveryMode"] })}
							>
								<SelectOption value="off" label="Off" />
								<SelectOption value="pr" label="Auto PR" />
								<SelectOption value="yolo" label="YOLO" />
							</Select>
						</div>
					</FieldRow>
					<FieldRow
						label="Auto commit"
						description="Commit pending changes automatically when merging or creating a PR."
					>
						<RHFSwitch name="autoCommit" onChange={(v) => onUpdate({ ...config, autoCommit: Boolean(v) })} />
					</FieldRow>
				</div>

				{/* Runtime */}
				<div className="flex flex-col gap-4">
					<SectionDivider title="Runtime" />
					<FieldRow
						label="Max parallel tasks"
						description="Maximum tasks in progress at once. Overrides global default."
					>
						<RHFNumberInput
							className="w-14"
							inputClassName="text-center"
							name="maxParallelTasks"
							placeholder="-"
							maxFractionDigits={0}
							positiveOnly
							onChange={(v) => onUpdate({ ...config, maxParallelTasks: toNum(v) })}
						/>
					</FieldRow>
					<FieldRow label="Max auto-fix attempts" description="Times an agent retries after a failing review.">
						<RHFNumberInput
							className="w-14"
							inputClassName="text-center"
							name="maxAutoFixAttempts"
							placeholder="-"
							maxFractionDigits={0}
							positiveOnly
							onChange={(v) => onUpdate({ ...config, maxAutoFixAttempts: toNum(v) })}
						/>
					</FieldRow>
					<FieldRow label="Polling interval (s)" description="Seconds between status checks.">
						<RHFNumberInput
							className="w-14"
							inputClassName="text-center"
							name="pollingIntervalSeconds"
							placeholder="-"
							maxFractionDigits={0}
							positiveOnly
							onChange={(v) => onUpdate({ ...config, pollingIntervalSeconds: toNum(v) })}
						/>
					</FieldRow>
				</div>

				{/* Git Defaults */}
				<div className="flex flex-col gap-4">
					<SectionDivider title="Git Defaults" />
					<FieldRow label="Default base branch" description="Used when creating new tasks and stories.">
						<div className="w-40">
							<BranchSelect
								branches={branches}
								value={defaultBaseBranch}
								onChange={(v) => {
									methods.setValue("defaultBaseBranch", v || undefined, { shouldDirty: true });
									onUpdate({ ...config, defaultBaseBranch: v || undefined });
								}}
								placeholder="main"
							/>
						</div>
					</FieldRow>
				</div>

				{/* Assistant */}
				<div className="flex flex-col gap-4">
					<SectionDivider title="Assistant" />
					<div className="flex flex-col gap-1.5">
						<span className="text-[13px] font-medium text-[#ededed]">Agent &amp; model</span>
						<span className="text-[11px] text-[#5f6672]">
							Default agent for the in-app assistant, used unless you pick a different model when opening a session.
						</span>
						<div className="mt-1 max-w-xl">
							<AgentModelPicker
								value={config.assistantModel ?? DEFAULT_AGENT_MODEL_CHOICE}
								onChange={(assistantModel) => onUpdate({ ...config, assistantModel })}
							/>
						</div>
					</div>
				</div>

				<SaveRow saving={saving} onSave={onSave} />
			</div>
		</FormProvider>
	);
}
