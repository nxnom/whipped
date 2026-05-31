import { Button, RHFNumberInput, RHFSelect, SelectOption, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AGENT_BINARY_OPTIONS } from "@runtime-contract";
import { type GlobalConfigForm, type GlobalConfigFormInput, globalConfigFormSchema } from "@runtime-validation/config";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import type { GlobalSection } from "./_shared";

function PageHeader({ title, description }: { title: string; description: string }) {
	return (
		<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
			<h1 className="text-xl font-semibold text-[#f0f0f5]">{title}</h1>
			<p className="text-[13px] text-[#60607a]">{description}</p>
		</div>
	);
}

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold text-[#f0f0f5]">{title}</span>
			<div className="flex-1 h-px bg-[#1a1a1f]" />
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[#c0c0d0]">{label}</span>
				<span className="text-[11px] text-[#60607a]">{description}</span>
			</div>
			{children}
		</div>
	);
}

const selectClassName =
	"w-[240px] font-mono text-[12px] focus:outline-none focus:border-[#7c6aff] cursor-pointer text-[#c0c0d0] bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px]";

// biome-ignore lint/correctness/noUnusedFunctionParameters: required by caller interface
export function GlobalSettings({ section }: { section: GlobalSection }) {
	const { data: config } = useRead((api) => api("config").GET());
	const { data: terminals } = useRead((api) => api("fs/terminals").GET());
	const { trigger: saveConfig, loading: saving } = useWrite((api) => api("config").PUT());
	const { trigger: logout } = useWrite((api) => api("auth/logout").POST());

	const methods = useForm<GlobalConfigFormInput, unknown, GlobalConfigForm>({
		resolver: zodResolver(globalConfigFormSchema),
		values: config as GlobalConfigFormInput | undefined,
	});

	const onSubmit = methods.handleSubmit(async (values) => {
		const res = await saveConfig({ body: values });
		if (res.error) {
			toast.error("Failed to save settings");
			return;
		}
		methods.reset(res.data as RuntimeGlobalConfig);
		toast.success("Settings saved");
	});

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<PageHeader title="Global Runtime Config" description="Settings that apply across all projects" />
				<div className="flex items-center justify-center py-20 text-sm text-[#60607a]">Loading...</div>
			</div>
		);
	}

	const terminalOptions = (terminals ?? []).map((t) => ({
		value: t.id,
		label: t.label,
	}));

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader title="Global Runtime Config" description="Settings that apply across all projects" />
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<FormProvider {...methods}>
					<form onSubmit={onSubmit} className="flex flex-col gap-6">
						{/* Defaults */}
						<div className="flex flex-col gap-4">
							<SectionDivider title="Defaults" />
							<FieldRow label="Default Agent" description="Agent binary for new workflow slots">
								<RHFSelect wrapperClassName="w-fit" name="defaultAgent" className={selectClassName}>
									{AGENT_BINARY_OPTIONS.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</FieldRow>
							<FieldRow label="Terminal App" description="Application for opening terminals">
								<RHFSelect
									wrapperClassName="w-fit"
									name="terminalApp"
									placeholder="System default"
									clearable
									className={selectClassName}
								>
									{terminalOptions.map((o) => (
										<SelectOption key={o.value} value={o.value} label={o.label} />
									))}
								</RHFSelect>
							</FieldRow>
						</div>

						{/* Concurrency & Limits */}
						<div className="flex flex-col gap-4">
							<SectionDivider title="Concurrency & Limits" />
							<FieldRow label="Max Parallel Tasks" description="Concurrent task executions">
								<RHFNumberInput
									name="maxParallelTasks"
									maxFractionDigits={0}
									className="w-14"
									inputClassName="text-center"
								/>
							</FieldRow>
							<FieldRow label="Max Parallel QA" description="Concurrent QA slot runs">
								<RHFNumberInput
									name="maxParallelQA"
									maxFractionDigits={0}
									className="w-14"
									inputClassName="text-center"
								/>
							</FieldRow>
							<FieldRow label="Max Auto-Fix Attempts" description="Retries before marking blocked">
								<RHFNumberInput
									name="maxAutoFixAttempts"
									maxFractionDigits={0}
									className="w-14"
									inputClassName="text-center"
								/>
							</FieldRow>
						</div>

						{/* Polling */}
						<div className="flex flex-col gap-4">
							<SectionDivider title="Polling" />
							<FieldRow label="Polling Interval" description="Board refresh interval (seconds)">
								<RHFNumberInput
									name="pollingIntervalSeconds"
									maxFractionDigits={0}
									className="w-14"
									inputClassName="text-center"
								/>
							</FieldRow>
							<FieldRow label="PR Poll Interval" description="PR status check interval (seconds)">
								<RHFNumberInput
									name="prPollingIntervalSeconds"
									maxFractionDigits={0}
									className="w-14"
									inputClassName="text-center"
								/>
							</FieldRow>
						</div>

						<div className="flex justify-end pt-2">
							<Button type="submit" disabled={saving}>
								{saving ? "Saving..." : "Save"}
							</Button>
						</div>
					</form>
				</FormProvider>

				<div className="flex flex-col gap-4 pt-6 mt-6 border-t border-[#1a1a1f]">
					<SectionDivider title="Session" />
					<FieldRow label="Sign out" description="End your session on this browser. Local access stays open.">
						<Button variant="outlined" onClick={() => logout()}>
							Sign out
						</Button>
					</FieldRow>
				</div>
			</div>
		</div>
	);
}
