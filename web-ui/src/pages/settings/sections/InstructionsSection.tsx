import { RHFTextarea, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { DEFAULT_GIT_INSTRUCTIONS } from "@runtime-contract";
import { type InstructionsForm, instructionsFormSchema } from "@runtime-validation/config";
import { RotateCcw } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

function SectionDivider({ title, action }: { title: string; action?: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-[15px] font-semibold shrink-0 text-whip-text">{title}</span>
			<div className="flex-1 h-px bg-whip-panel" />
			{action}
		</div>
	);
}

const textareaClassName =
	"bg-whip-panel border border-whip-border rounded-lg px-4 py-3.5 text-whip-text font-mono text-[12px] leading-relaxed resize-none outline-none w-full";

export function InstructionsSection({ config, workspaceId }: { config: RuntimeProjectConfig; workspaceId: string }) {
	const methods = useForm<InstructionsForm, unknown, InstructionsForm>({
		resolver: zodResolver(instructionsFormSchema),
		values: {
			systemPrompt: config.systemPrompt,
			gitInstructions: config.gitInstructions,
		},
	});

	const { trigger: saveProjectConfig } = useWrite((api) => api("project-config").PUT());

	const onSubmit = async ({ systemPrompt, gitInstructions }: InstructionsForm) => {
		try {
			const res = await saveProjectConfig({
				body: {
					workspaceId,
					config: { ...config, systemPrompt: systemPrompt || undefined, gitInstructions: gitInstructions || undefined },
				},
			});
			if (res.error) throw res.error;
			toast.success("Settings saved");
		} catch {
			toast.error("Failed to save settings");
		}
	};

	const loadDefaultGitInstructions = () => {
		methods.setValue("gitInstructions", DEFAULT_GIT_INSTRUCTIONS, { shouldDirty: true });
	};

	return (
		<FormProvider {...methods}>
			<div className="flex flex-col h-full">
				<div className="flex-1 flex flex-col gap-7 px-10 py-6 min-h-0">
					{/* Shared System Prompt */}
					<div className="flex flex-col gap-3 shrink-0">
						<SectionDivider title="Shared System Prompt" />
						<p className="text-[12px] text-whip-faint">
							Appended to all agents (dev, code review, QA, assistant). Use for tech stack, project goals, or any
							context all agents should know.
						</p>
						<RHFTextarea
							name="systemPrompt"
							placeholder={
								"Tech stack: Next.js 15, TypeScript, Postgres\nWebsite: https://app.example.com\n\nGoals:\n- Keep bundle size under 200kb\n- Follow REST conventions"
							}
							className={classNames(textareaClassName, "h-[180px]")}
						/>
					</div>

					{/* Git Conventions */}
					<div className="flex flex-col gap-3 flex-1 min-h-0">
						<SectionDivider
							title="Git Conventions"
							action={
								<button
									onClick={loadDefaultGitInstructions}
									className="flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0 border border-whip-border rounded-[5px] px-2.5 py-[5px] bg-transparent text-whip-muted"
								>
									<RotateCcw size={12} />
									<span className="text-[11px]">Load Default</span>
								</button>
							}
						/>
						<p className="text-[12px] shrink-0 text-whip-faint">
							Custom rules for commit messages, PR titles, and PR descriptions. The dev agent reads these when writing
							git messages.
						</p>
						<RHFTextarea
							name="gitInstructions"
							placeholder={DEFAULT_GIT_INSTRUCTIONS}
							className={classNames(textareaClassName, "flex-1")}
						/>
					</div>
				</div>

				{/* Save */}
				<div className="shrink-0 flex justify-end px-10 py-4 border-t border-whip-border">
					<button
						onClick={methods.handleSubmit(onSubmit)}
						disabled={methods.formState.isSubmitting}
						className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50 bg-whip-accent text-whip-accent-text"
					>
						{methods.formState.isSubmitting ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</FormProvider>
	);
}
