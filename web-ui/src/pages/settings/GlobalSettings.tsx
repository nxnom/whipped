import { Button, RHFNumberInput, RHFSelect, SelectOption, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AGENT_BINARY_OPTIONS } from "@runtime-contract";
import { type GlobalConfigForm, type GlobalConfigFormInput, globalConfigFormSchema } from "@runtime-validation/config";
import { Moon, Sun } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { setTheme, useTheme } from "@/stores/theme-store";
import { classNames } from "@/utils/classNames";
import type { GlobalSection } from "./_shared";

function PageHeader({ title, description }: { title: string; description: string }) {
	return (
		<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-whip-border">
			<h1 className="text-xl font-semibold text-whip-text">{title}</h1>
			<p className="text-[13px] text-whip-faint">{description}</p>
		</div>
	);
}

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold text-whip-text">{title}</span>
			<div className="flex-1 h-px bg-whip-panel" />
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium text-whip-text">{label}</span>
				<span className="text-[11px] text-whip-faint">{description}</span>
			</div>
			{children}
		</div>
	);
}

const selectClassName =
	"w-[240px] font-mono text-[12px] focus:outline-none focus:border-whip-accent cursor-pointer text-whip-text bg-whip-panel border border-whip-border rounded-md px-3 py-[9px]";

// Lives here rather than in the topbar so switching it never happens while a
// terminal session is mounted — xterm's canvas renderer doesn't pick up the
// new theme colors live, only on next mount, so toggling from a page that
// always fully remounts (this one) avoids leaving a stale-colored terminal.
function ThemeToggle() {
	const theme = useTheme();
	return (
		<div className="flex items-center gap-0.5 shrink-0 rounded-lg border border-whip-border bg-whip-bg p-[3px]">
			{(
				[
					{ value: "dark" as const, label: "Dark", Icon: Moon },
					{ value: "light" as const, label: "Light", Icon: Sun },
				] satisfies { value: "dark" | "light"; label: string; Icon: typeof Moon }[]
			).map(({ value, label, Icon }) => (
				<button
					key={value}
					type="button"
					onClick={() => setTheme(value)}
					className={classNames(
						"flex items-center gap-1.5 h-7 px-3 rounded-[5px] text-xs font-bold transition-colors",
						theme === value ? "bg-whip-panel-2 text-whip-text" : "text-whip-faint hover:text-whip-muted",
					)}
				>
					<Icon size={13} />
					{label}
				</button>
			))}
		</div>
	);
}

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
				<PageHeader title="Preferences" description="Settings that apply across all projects" />
				<div className="flex items-center justify-center py-20 text-sm text-whip-faint">Loading...</div>
			</div>
		);
	}

	const terminalOptions = (terminals ?? []).map((t) => ({
		value: t.id,
		label: t.label,
	}));

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader title="Preferences" description="Settings that apply across all projects" />
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

				<div className="flex flex-col gap-4 pt-6 mt-6 border-t border-whip-panel">
					<SectionDivider title="Appearance" />
					<FieldRow label="Theme" description="Light or dark UI, applied on this browser">
						<ThemeToggle />
					</FieldRow>
				</div>

				<div className="flex flex-col gap-4 pt-6 mt-6 border-t border-whip-panel">
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
