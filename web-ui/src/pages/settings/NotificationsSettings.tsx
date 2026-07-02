import { Button, RHFSwitch, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { NotificationSoundsConfig } from "@runtime-contract";
import {
	type NotificationSoundsForm,
	type NotificationSoundsFormInput,
	notificationSoundsFormSchema,
} from "@runtime-validation/config";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";

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

const PER_EVENT_ROWS: Array<{ name: keyof NotificationSoundsConfig; label: string; description: string }> = [
	{ name: "readyForReview", label: "Ready for Review", description: "A task finished and is waiting for your review" },
	{ name: "prComment", label: "New PR comment", description: "A reviewer commented on a task's pull request" },
	{ name: "done", label: "Done / PR merged", description: "A task's pull request was merged" },
	{ name: "reopened", label: "Reopened", description: "Changes were requested — the task needs another pass" },
	{ name: "blocked", label: "Blocked", description: "A task was blocked (PR closed, or auto-fix attempts exhausted)" },
	{ name: "runError", label: "Run error", description: "A run/preview process exited with an error" },
];

export function NotificationsSettings() {
	const { data: config } = useRead((api) => api("config").GET());
	const { trigger: saveConfig, loading: saving } = useWrite((api) => api("config").PUT());

	const methods = useForm<NotificationSoundsFormInput, unknown, NotificationSoundsForm>({
		resolver: zodResolver(notificationSoundsFormSchema),
		values: config?.notificationSounds,
	});

	const onSubmit = methods.handleSubmit(async (values) => {
		const res = await saveConfig({ body: { notificationSounds: values } });
		if (res.error) {
			toast.error("Failed to save settings");
			return;
		}
		methods.reset(values);
		toast.success("Settings saved");
	});

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<PageHeader title="Notifications" description="Sounds played on the daemon host when tasks need you" />
				<div className="flex items-center justify-center py-20 text-sm text-whip-faint">Loading...</div>
			</div>
		);
	}

	const enabled = methods.watch("enabled");

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader title="Notifications" description="Sounds played on the daemon host when tasks need you" />
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<FormProvider {...methods}>
					<form onSubmit={onSubmit} className="flex flex-col gap-6">
						<div className="flex flex-col gap-4">
							<SectionDivider title="Sounds" />
							<FieldRow
								label="Notification sounds"
								description="Play a sound on the machine running Whipped — works even when no browser is open"
							>
								<RHFSwitch name="enabled" />
							</FieldRow>
						</div>

						<div className={enabled ? "flex flex-col gap-4" : "flex flex-col gap-4 opacity-50"}>
							<SectionDivider title="Events" />
							{PER_EVENT_ROWS.map((row) => (
								<FieldRow key={row.name} label={row.label} description={row.description}>
									<RHFSwitch name={row.name} />
								</FieldRow>
							))}
						</div>

						<div className="flex justify-end pt-2">
							<Button type="submit" disabled={saving}>
								{saving ? "Saving..." : "Save"}
							</Button>
						</div>
					</form>
				</FormProvider>
			</div>
		</div>
	);
}
