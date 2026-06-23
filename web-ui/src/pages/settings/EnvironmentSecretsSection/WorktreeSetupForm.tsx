import { RHFInput } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeProjectConfig, RuntimeWorktreeCopyEntry } from "@runtime-contract";
import { type EnvironmentForm, type EnvironmentFormInput, environmentFormSchema } from "@runtime-validation/config";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { monoInputClassName } from "./constants";
import { FilesBox } from "./FilesBox";
import { LabelCol } from "./LabelCol";
import { SectionDivider } from "./SectionDivider";

// Split into its own component so the RHF instance lives at the top level and is
// fed `values` from the parent-owned config. Field changes flow back through the
// parent's onUpdate, preserving the existing config-update contract.

export function WorktreeSetupForm({
	workspaceId,
	config,
	onUpdate,
}: {
	workspaceId: string;
	config: RuntimeProjectConfig;
	onUpdate: (next: RuntimeProjectConfig) => void;
}) {
	const setup = config.worktreeSetup ?? { filesToCopy: [], installCommand: "" };

	const methods = useForm<EnvironmentFormInput, unknown, EnvironmentForm>({
		resolver: zodResolver(environmentFormSchema),
		values: {
			filesToCopy: setup.filesToCopy,
			installCommand: setup.installCommand,
			startCommand: config.startCommand ?? "",
		},
	});
	const { control, setValue } = methods;

	const filesToCopy = (useWatch({ control, name: "filesToCopy" }) ?? []) as RuntimeWorktreeCopyEntry[];

	const setFiles = (files: RuntimeWorktreeCopyEntry[]) => {
		setValue("filesToCopy", files, { shouldDirty: true });
		onUpdate({ ...config, worktreeSetup: { ...setup, filesToCopy: files } });
	};

	return (
		<FormProvider {...methods}>
			<div className="flex flex-col gap-4">
				<SectionDivider title="Worktree Setup" />

				{/* Install Command */}
				<div className="flex items-center gap-4">
					<LabelCol label="Install Command" />
					<RHFInput
						name="installCommand"
						placeholder="pnpm install --frozen-lockfile"
						inputClassName={monoInputClassName}
						className="flex-1"
						onChange={(v) => onUpdate({ ...config, worktreeSetup: { ...setup, installCommand: v ?? "" } })}
					/>
				</div>

				{/* Start Command */}
				<div className="flex items-center gap-4">
					<LabelCol label="Start Command" />
					<RHFInput
						name="startCommand"
						placeholder="pnpm dev"
						inputClassName={monoInputClassName}
						className="flex-1"
						onChange={(v) => onUpdate({ ...config, startCommand: v ?? "" })}
					/>
				</div>

				{/* Files to Copy */}
				<div className="flex gap-4">
					<LabelCol label="Files to Copy" description="Copied into worktrees" />
					<FilesBox workspaceId={workspaceId} filesToCopy={filesToCopy} onChange={setFiles} />
				</div>
			</div>
		</FormProvider>
	);
}
