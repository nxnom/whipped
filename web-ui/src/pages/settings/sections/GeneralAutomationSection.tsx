import { RHFNumberInput, RHFSwitch, Switch } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeProjectConfig } from "@runtime-contract";
import {
	type GeneralAutomationForm,
	type GeneralAutomationFormInput,
	generalAutomationFormSchema,
} from "@runtime-validation/config";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { BranchSelect } from "@/components/BranchSelect";
import { SaveRow } from "../_shared";

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-sm font-semibold text-[#f0f0f5]">{title}</span>
			<div className="flex-1 h-px bg-[#2a2a35]" />
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[#f0f0f5]">{label}</span>
				<span className="text-[11px] text-[#4a4a5a]">{description}</span>
			</div>
			{children}
		</div>
	);
}

export function GeneralAutomationSection({
	config,
	branches,
	saving,
	togglingAutonomous,
	onToggleAutonomous,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	branches: string[];
	saving: boolean;
	togglingAutonomous: boolean;
	onToggleAutonomous: () => void;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	const methods = useForm<GeneralAutomationFormInput, unknown, GeneralAutomationForm>({
		resolver: zodResolver(generalAutomationFormSchema),
		values: {
			autoPR: config.autoPR ?? false,
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
				{/* Automation */}
				<div className="flex flex-col gap-4">
					<SectionDivider title="Automation" />
					<FieldRow label="Autonomous mode" description="Automatically pick up Ready and Reopened tasks when idle.">
						{/* Direct toggle — backed by a dedicated API call, not the form. */}
						<Switch
							checked={config.autonomousModeEnabled}
							onChange={onToggleAutonomous}
							disabled={togglingAutonomous}
						/>
					</FieldRow>
					<FieldRow label="Auto PR" description="Push branch and open PR when all reviews pass.">
						<RHFSwitch name="autoPR" onChange={(v) => onUpdate({ ...config, autoPR: Boolean(v) })} />
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

				<SaveRow saving={saving} onSave={onSave} />
			</div>
		</FormProvider>
	);
}
