import { RHFTextarea } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { DEFAULT_GIT_INSTRUCTIONS } from "@runtime-contract";
import { type InstructionsForm, instructionsFormSchema } from "@runtime-validation/config";
import { RotateCcw } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { classNames } from "@/utils/classNames";

function SectionDivider({ title, action }: { title: string; action?: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-[15px] font-semibold shrink-0 text-[#f0f0f5]">{title}</span>
			<div className="flex-1 h-px bg-[#1a1a1f]" />
			{action}
		</div>
	);
}

const textareaClassName =
	"bg-[#0c0c0f] border border-[#2a2a35] rounded-lg px-4 py-3.5 text-[#c0c0d0] font-mono text-[12px] leading-relaxed resize-none outline-none w-full";

export function InstructionsSection({
	config,
	saving,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	const methods = useForm<InstructionsForm, unknown, InstructionsForm>({
		resolver: zodResolver(instructionsFormSchema),
		values: {
			systemPrompt: config.systemPrompt,
			gitInstructions: config.gitInstructions,
		},
	});

	// RHF owns the form state; mirror each change back into the parent-owned config
	// so the existing onUpdate contract is preserved (no direct API call here).
	// Empty strings normalise to undefined, matching the prior behaviour.
	const norm = (v: string | null): string | undefined => v || undefined;

	const loadDefaultGitInstructions = () => {
		methods.setValue("gitInstructions", DEFAULT_GIT_INSTRUCTIONS, { shouldDirty: true });
		onUpdate({ ...config, gitInstructions: DEFAULT_GIT_INSTRUCTIONS });
	};

	return (
		<FormProvider {...methods}>
			<div className="flex flex-col h-full">
				<div className="flex-1 flex flex-col gap-7 px-10 py-6 min-h-0">
					{/* Shared System Prompt */}
					<div className="flex flex-col gap-3 shrink-0">
						<SectionDivider title="Shared System Prompt" />
						<p className="text-[12px] text-[#60607a]">
							Appended to all agents (dev, code review, QA, assistant). Use for tech stack, project goals, or any
							context all agents should know.
						</p>
						<RHFTextarea
							name="systemPrompt"
							placeholder={
								"Tech stack: Next.js 15, TypeScript, Postgres\nWebsite: https://app.example.com\n\nGoals:\n- Keep bundle size under 200kb\n- Follow REST conventions"
							}
							className={classNames(textareaClassName, "h-[180px]")}
							onChange={(v) => onUpdate({ ...config, systemPrompt: norm(v) })}
						/>
					</div>

					{/* Git Conventions */}
					<div className="flex flex-col gap-3 flex-1 min-h-0">
						<SectionDivider
							title="Git Conventions"
							action={
								<button
									onClick={loadDefaultGitInstructions}
									className="flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0 border border-[#2a2a35] rounded-[5px] px-2.5 py-[5px] bg-transparent text-[#8888a0]"
								>
									<RotateCcw size={12} />
									<span className="text-[11px]">Load Default</span>
								</button>
							}
						/>
						<p className="text-[12px] shrink-0 text-[#60607a]">
							Custom rules for commit messages, PR titles, and PR descriptions. The dev agent reads these when writing
							git messages.
						</p>
						<RHFTextarea
							name="gitInstructions"
							placeholder={DEFAULT_GIT_INSTRUCTIONS}
							className={classNames(textareaClassName, "flex-1")}
							onChange={(v) => onUpdate({ ...config, gitInstructions: norm(v) })}
						/>
					</div>
				</div>

				{/* Save */}
				<div className="shrink-0 flex justify-end px-10 py-4 border-t border-[#2a2a35]">
					<button
						onClick={onSave}
						disabled={saving}
						className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50 bg-[#7c6aff] text-white"
					>
						{saving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</FormProvider>
	);
}
