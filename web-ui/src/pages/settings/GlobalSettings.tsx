import { Input, Select, SelectOption, toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AGENT_BINARY_OPTIONS } from "@runtime-contract";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { Field, SaveRow, SectionHeader, type GlobalSection } from "./_shared";

export function GlobalSettings({ section }: { section: GlobalSection }) {
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const [terminals, setTerminals] = useState<Array<{ id: string; label: string }>>([]);

	useEffect(() => {
		trpc.config.get
			.query()
			.then(setConfig)
			.catch(() => {});
		trpc.fs.listTerminals
			.query()
			.then(setTerminals)
			.catch(() => {});
	}, []);

	const handleSave = async () => {
		if (!config) return;
		setSaving(true);
		try {
			const updated = await trpc.config.save.mutate(config);
			setConfig(updated);
			toast.success("Settings saved");
		} catch {
			toast.error("Failed to save settings");
		} finally {
			setSaving(false);
		}
	};

	if (!config) {
		return <div className="flex items-center justify-center py-20 text-gray-500 text-sm">Loading...</div>;
	}

	return (
		<div className="p-6 max-w-xl space-y-6">
			{section === "general" && (
				<>
					<SectionHeader title="General" description="Runtime behavior settings that apply to all projects." />
					<div className="space-y-4">
						<Field label="Default Agent">
							<Select
								value={config.defaultAgent}
								onChange={(v) => setConfig({ ...config, defaultAgent: v as "claude" | "codex" })}
								placeholder="Select agent"
							>
								{AGENT_BINARY_OPTIONS.map((o) => (
									<SelectOption key={o.value} value={o.value} label={o.label} />
								))}
							</Select>
						</Field>
						<div className="grid grid-cols-2 gap-3">
							<Field label="Max Parallel Tasks">
								<Input
									type="number"
									value={String(config.maxParallelTasks)}
									onChange={(e) => setConfig({ ...config, maxParallelTasks: Number(e.target.value) })}
								/>
							</Field>
							<Field label="Max Auto-Fix Attempts">
								<Input
									type="number"
									value={String(config.maxAutoFixAttempts)}
									onChange={(e) => setConfig({ ...config, maxAutoFixAttempts: Number(e.target.value) })}
								/>
							</Field>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Field label="Polling Interval (s)">
								<Input
									type="number"
									value={String(config.pollingIntervalSeconds)}
									onChange={(e) => setConfig({ ...config, pollingIntervalSeconds: Number(e.target.value) })}
								/>
							</Field>
							<Field label="Max Parallel QA">
								<Input
									type="number"
									value={String(config.maxParallelQA)}
									onChange={(e) => setConfig({ ...config, maxParallelQA: Number(e.target.value) })}
								/>
							</Field>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Field label="PR Poll Interval (s)">
								<Input
									type="number"
									value={String(config.prPollingIntervalSeconds)}
									onChange={(e) => setConfig({ ...config, prPollingIntervalSeconds: Number(e.target.value) })}
								/>
							</Field>
							<Field label="Terminal App">
								<Select
									value={config.terminalApp ?? ""}
									onChange={(v) => setConfig({ ...config, terminalApp: (v as string) || undefined })}
									placeholder="System default"
									clearable
								>
									{terminals.map((t) => (
										<SelectOption key={t.id} value={t.id} label={t.label} />
									))}
								</Select>
							</Field>
						</div>
					</div>
					<SaveRow saving={saving} onSave={handleSave} />
				</>
			)}
		</div>
	);
}
