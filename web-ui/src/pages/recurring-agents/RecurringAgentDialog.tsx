import { RHFInput, RHFSelect, RHFSwitch, RHFTextarea, SelectOption, toast } from "@geckoui/geckoui";
import {
	AGENT_BINARY_OPTIONS,
	type EffortLevel,
	EFFORT_OPTIONS,
	type RecurringAgent,
	type RuntimeAgentId,
} from "@runtime-contract";
import { Plus, X } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { RHFModelSelect } from "@/components/RHFModelSelect";
import { useWrite } from "@/runtime/api-client";
import { DEFAULT_INTERVAL_SECONDS } from "./constants";
import { fieldsToSchedule, type ScheduleFields, scheduleToFields } from "./helpers";
import { ScheduleEditor } from "./ScheduleEditor";

const ACCENT = "#ffffff";

interface FormValues extends ScheduleFields {
	name: string;
	instructions: string;
	agentId: RuntimeAgentId;
	model: string | null;
	effort: EffortLevel | "";
	enabled: boolean;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return <span className="text-[11px] font-medium text-[#5f6672]">{children}</span>;
}

export function RecurringAgentDialog({
	workspaceId,
	agent,
	onClose,
}: {
	workspaceId: string;
	agent?: RecurringAgent;
	onClose: () => void;
}) {
	const isEdit = !!agent;
	const methods = useForm<FormValues>({
		defaultValues: {
			name: agent?.name ?? "",
			instructions: agent?.instructions ?? "",
			agentId: agent?.model.agentId ?? "claude",
			model: agent?.model.model ?? null,
			effort: agent?.model.effort ?? "low",
			enabled: agent?.enabled ?? true,
			...scheduleToFields(agent?.schedule ?? { kind: "interval", intervalSeconds: DEFAULT_INTERVAL_SECONDS }),
		},
	});

	const create = useWrite((api) => api("recurring-agents").POST());
	const update = useWrite((api) => api("recurring-agents/:id").PATCH());
	const loading = create.loading || update.loading;

	const onSubmit = methods.handleSubmit(async (v) => {
		const payload = {
			name: v.name.trim(),
			instructions: v.instructions,
			schedule: fieldsToSchedule(v),
			model: { agentId: v.agentId, model: v.model ?? null, effort: v.effort || null },
			enabled: v.enabled,
		};
		const res = agent
			? await update.trigger({ params: { id: agent.id }, body: payload })
			: await create.trigger({ body: { workspaceId, ...payload } });
		if (res.error) {
			toast.error(`Failed to ${isEdit ? "update" : "create"} agent`);
			return;
		}
		toast.success(isEdit ? "Agent updated" : "Agent created");
		onClose();
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={onClose} />

			<FormProvider {...methods}>
				<form
					onSubmit={onSubmit}
					className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1400px] max-w-[calc(100vw-80px)] rounded-xl bg-[#0b0b0b] border border-[#2a2a2a] shadow-[0_8px_40px_4px_#00000060] overflow-hidden"
				>
					{/* ── Left panel ── */}
					<div className="flex flex-col flex-1 overflow-hidden">
						<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a2a] shrink-0">
							<span className="text-[15px] font-semibold text-[#ededed]">
								{isEdit ? "Edit Recurring Agent" : "New Recurring Agent"}
							</span>
							<div className="flex-1" />
							<button type="button" onClick={onClose} className="text-[#5f6672] hover:text-[#ededed] transition-colors">
								<X size={18} />
							</button>
						</div>

						<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-3">
							<RHFInput
								name="name"
								rules={{ required: "Name is required" }}
								placeholder="Agent name — e.g. Security sweep"
							/>
							<div className="flex items-center gap-1.5 shrink-0">
								<FieldLabel>Instructions</FieldLabel>
								<div className="flex-1" />
								<span className="text-[10px] text-[#5f6672]">What to do each run, and how to use the journal</span>
							</div>
							<RHFTextarea
								name="instructions"
								className="flex-1 min-h-0"
								placeholder="Check for new dependency vulnerabilities. File a card for anything not already in your journal."
							/>
						</div>
					</div>

					{/* ── Right config sidebar ── */}
					<div className="w-80 shrink-0 bg-[#111111] border-l border-[#2a2a2a] flex flex-col overflow-hidden">
						<div className="px-[18px] py-3.5 border-b border-[#2a2a2a] shrink-0">
							<span className="text-xs font-semibold text-[#8a8f98]">Configuration</span>
						</div>

						<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
							<div className="flex flex-col gap-2">
								<FieldLabel>Schedule</FieldLabel>
								<ScheduleEditor />
							</div>

							<div className="flex flex-col gap-2">
								<FieldLabel>Agent</FieldLabel>
								<RHFSelect name="agentId" onChange={() => methods.setValue("model", null)}>
									{AGENT_BINARY_OPTIONS.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</div>

							<div className="flex flex-col gap-2">
								<FieldLabel>Model</FieldLabel>
								<RHFModelSelect name="model" agentName="agentId" menuClassName="w-fit" />
							</div>

							<div className="flex flex-col gap-2">
								<FieldLabel>Effort</FieldLabel>
								<RHFSelect name="effort">
									<SelectOption value="" label="Default effort" />
									{EFFORT_OPTIONS.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</div>
						</div>

						<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a2a] shrink-0">
							<label className="flex items-center gap-1.5">
								<RHFSwitch name="enabled" />
								<span className="text-[11px] text-[#8a8f98]">Enabled</span>
							</label>
							<div className="flex-1" />
							<button
								type="submit"
								disabled={loading}
								className="flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
								style={{ background: ACCENT }}
							>
								<Plus size={14} />
								{loading ? "Saving..." : isEdit ? "Save Changes" : "Create Agent"}
							</button>
						</div>
					</div>
				</form>
			</FormProvider>
		</div>
	);
}
