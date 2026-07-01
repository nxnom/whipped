import { RHFInput, RHFSelect, RHFSwitch, SelectOption, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_AGENT_MODEL_CHOICE, type AgentModelChoice, type Workflow } from "@runtime-contract";
import { type CompanionStartForm, companionStartFormSchema } from "@runtime-validation/companion";
import { GitBranch, Workflow as WorkflowIcon, X } from "lucide-react";
import { useMemo, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { BranchSelect } from "@/components/BranchSelect";
import { useRead } from "@/runtime/api-client";
import { useCompanionSessions } from "./useCompanionSessions";

function FieldLabel({ children }: { children: React.ReactNode }) {
	return <span className="text-[11px] font-medium text-[#60607a]">{children}</span>;
}

export function CompanionStartDialog({
	workspaceId,
	workflows,
	onClose,
	onCreated,
}: {
	workspaceId: string;
	workflows: Workflow[];
	onClose: () => void;
	onCreated: (sessionId: string) => void;
}) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	// Same "default, else first" pick as the ticket create dialog (TaskDialog.tsx).
	const defaultTaskWorkflow = taskWorkflows.find((w) => w.isDefault) ?? taskWorkflows[0];

	const modelFromWorkflow = (workflow?: Workflow): AgentModelChoice => {
		const pair = workflow?.slots.find((s) => s.type === "dev")?.pairs[0];
		return pair
			? { agentId: pair.binary, model: pair.model ?? null, effort: pair.effort ?? null }
			: DEFAULT_AGENT_MODEL_CHOICE;
	};

	const [model, setModel] = useState<AgentModelChoice>(() => modelFromWorkflow(defaultTaskWorkflow));

	const { data: branchesData } = useRead((api) => api("cards/branches").GET({ query: { workspaceId } }));
	const branches = branchesData?.branches ?? [];
	const defaultBranch = branchesData?.defaultBranch ?? "";

	// `values` (not `defaultValues`) so the form reactively picks up defaultBranch
	// once the async branches read resolves, per the project's default-branch
	// seeding convention (see TaskDialog.tsx). Workflow defaults to the project's
	// default task workflow rather than "no workflow".
	const values = useMemo<CompanionStartForm>(
		() => ({ useWorktree: true, baseRef: defaultBranch, branchName: "", workflowId: defaultTaskWorkflow?.id ?? "" }),
		[defaultBranch, defaultTaskWorkflow?.id],
	);
	const methods = useForm<CompanionStartForm>({ resolver: zodResolver(companionStartFormSchema), values });
	const { control, setValue } = methods;

	const { create } = useCompanionSessions(workspaceId);

	const onWorkflowChange = (id: string) => {
		setModel(modelFromWorkflow(taskWorkflows.find((w) => w.id === id)));
	};

	const baseRef = useWatch({ control, name: "baseRef" });
	const useWorktree = useWatch({ control, name: "useWorktree" });

	const onSubmit = methods.handleSubmit(async (v) => {
		const res = await create.trigger({
			body: {
				workspaceId,
				useWorktree: v.useWorktree,
				baseRef: v.baseRef,
				branchName: v.useWorktree ? v.branchName.trim() : undefined,
				workflowId: v.workflowId || undefined,
				model,
			},
		});
		if (res.error || !res.data) {
			toast.error("Failed to start companion session");
			return;
		}
		toast.success("Companion session started");
		onCreated(res.data.id);
		onClose();
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={onClose} />

			<FormProvider {...methods}>
				<form
					onSubmit={onSubmit}
					className="relative flex flex-col w-[520px] max-w-[calc(100vw-80px)] max-h-[calc(100vh-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden"
				>
					<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
						<span className="text-[15px] font-semibold text-[#f0f0f5]">New Companion Session</span>
						<div className="flex-1" />
						<button type="button" onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
							<X size={18} />
						</button>
					</div>

					<div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-4">
						<div className="flex items-center justify-between gap-3 rounded-lg border border-[#2a2a35] px-3.5 py-3">
							<div className="flex flex-col gap-0.5">
								<span className="text-[13px] font-medium text-[#f0f0f5]">Isolated worktree</span>
								<span className="text-[11px] text-[#60607a]">
									{useWorktree
										? "Branches into its own worktree — safe to run alongside other work."
										: "Works directly in your main repo checkout — no worktree or new branch."}
								</span>
							</div>
							<RHFSwitch name="useWorktree" />
						</div>

						<div className="flex flex-col gap-1.5">
							<FieldLabel>Base branch</FieldLabel>
							<BranchSelect
								branches={branches}
								value={baseRef ?? ""}
								onChange={(v) => setValue("baseRef", v, { shouldValidate: true })}
								placeholder="Select branch"
							/>
						</div>

						{useWorktree && (
							<div className="flex flex-col gap-1.5">
								<FieldLabel>Branch name</FieldLabel>
								<RHFInput name="branchName" placeholder="e.g. fix/pagination-bug" prefix={<GitBranch size={13} />} />
							</div>
						)}

						<div className="flex flex-col gap-1.5">
							<FieldLabel>Workflow (optional)</FieldLabel>
							<RHFSelect
								name="workflowId"
								onChange={onWorkflowChange}
								placeholder="No workflow — blank agent"
								prefix={<WorkflowIcon size={14} className="text-[#8888a0]" />}
							>
								<SelectOption value="" label="No workflow — blank agent" />
								{taskWorkflows.map((w) => (
									<SelectOption key={w.id} value={w.id} label={w.name + (w.isDefault ? " (default)" : "")} />
								))}
							</RHFSelect>
						</div>

						<div className="flex flex-col gap-1.5">
							<FieldLabel>Agent &amp; model</FieldLabel>
							<AgentModelPicker value={model} onChange={setModel} />
						</div>
					</div>

					<div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-[#2a2a35] shrink-0">
						<div className="flex-1" />
						<button
							type="submit"
							disabled={create.loading}
							className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white bg-[#7c6aff] transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{create.loading ? "Starting..." : "Start Session"}
						</button>
					</div>
				</form>
			</FormProvider>
		</div>
	);
}
