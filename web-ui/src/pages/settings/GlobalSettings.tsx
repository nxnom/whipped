import { toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { AGENT_BINARY_OPTIONS } from "@runtime-contract";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { type GlobalSection } from "./_shared";

function PageHeader({ title, description }: { title: string; description: string }) {
	return (
		<div
			className="shrink-0 flex flex-col gap-1 px-10 py-6"
			style={{ borderBottom: "1px solid #2a2a35" }}
		>
			<h1 className="text-xl font-semibold" style={{ color: "#f0f0f5" }}>
				{title}
			</h1>
			<p className="text-[13px]" style={{ color: "#60607a" }}>
				{description}
			</p>
		</div>
	);
}

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>
				{title}
			</span>
			<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
		</div>
	);
}

function FieldRow({
	label,
	description,
	children,
}: {
	label: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium" style={{ color: "#c0c0d0" }}>
					{label}
				</span>
				<span className="text-[11px]" style={{ color: "#60607a" }}>
					{description}
				</span>
			</div>
			{children}
		</div>
	);
}

function NumberInput({
	value,
	onChange,
}: {
	value: number;
	onChange: (v: number) => void;
}) {
	return (
		<input
			type="number"
			value={value}
			onChange={(e) => onChange(Number(e.target.value))}
			className="text-center font-mono text-[12px] focus:outline-none focus:border-[#7c6aff]"
			style={{
				width: 80,
				padding: "9px 12px",
				background: "#0c0c0f",
				border: "1px solid #2a2a35",
				borderRadius: 6,
				color: "#c0c0d0",
			}}
		/>
	);
}

function SelectInput({
	value,
	onChange,
	options,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	options: ReadonlyArray<{ value: string; label: string }>;
	placeholder?: string;
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="font-mono text-[12px] focus:outline-none focus:border-[#7c6aff] cursor-pointer"
			style={{
				width: 240,
				padding: "9px 12px",
				background: "#0c0c0f",
				border: "1px solid #2a2a35",
				borderRadius: 6,
				color: "#c0c0d0",
				appearance: "none",
				backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2360607a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
				backgroundRepeat: "no-repeat",
				backgroundPosition: "right 12px center",
				paddingRight: 36,
			}}
		>
			{placeholder && (
				<option value="">{placeholder}</option>
			)}
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.label}
				</option>
			))}
		</select>
	);
}

function SaveButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
	return (
		<div className="flex justify-end pt-2">
			<button
				onClick={onSave}
				disabled={saving}
				className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
				style={{ background: "#7c6aff", color: "#ffffff" }}
			>
				{saving ? "Saving..." : "Save"}
			</button>
		</div>
	);
}

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
		return (
			<div className="flex-1 flex flex-col">
				<PageHeader title="Global Runtime Config" description="Settings that apply across all projects" />
				<div className="flex items-center justify-center py-20 text-sm" style={{ color: "#60607a" }}>
					Loading...
				</div>
			</div>
		);
	}

	const terminalOptions = terminals.map((t) => ({ value: t.id, label: t.label }));

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader title="Global Runtime Config" description="Settings that apply across all projects" />
			<div className="flex-1 overflow-y-auto px-10 py-6">
				<div className="flex flex-col gap-6">
					{/* Defaults */}
					<div className="flex flex-col gap-4">
						<SectionDivider title="Defaults" />
						<FieldRow label="Default Agent" description="Agent binary for new workflow slots">
							<SelectInput
								value={config.defaultAgent}
								onChange={(v) => setConfig({ ...config, defaultAgent: v as typeof config.defaultAgent })}
								options={AGENT_BINARY_OPTIONS}
							/>
						</FieldRow>
						<FieldRow label="Terminal App" description="Application for opening terminals">
							<SelectInput
								value={config.terminalApp ?? ""}
								onChange={(v) => setConfig({ ...config, terminalApp: v || undefined })}
								options={terminalOptions}
								placeholder="System default"
							/>
						</FieldRow>
					</div>

					{/* Concurrency & Limits */}
					<div className="flex flex-col gap-4">
						<SectionDivider title="Concurrency & Limits" />
						<FieldRow label="Max Parallel Tasks" description="Concurrent task executions">
							<NumberInput
								value={config.maxParallelTasks}
								onChange={(v) => setConfig({ ...config, maxParallelTasks: v })}
							/>
						</FieldRow>
						<FieldRow label="Max Parallel QA" description="Concurrent QA slot runs">
							<NumberInput
								value={config.maxParallelQA}
								onChange={(v) => setConfig({ ...config, maxParallelQA: v })}
							/>
						</FieldRow>
						<FieldRow label="Max Auto-Fix Attempts" description="Retries before marking blocked">
							<NumberInput
								value={config.maxAutoFixAttempts}
								onChange={(v) => setConfig({ ...config, maxAutoFixAttempts: v })}
							/>
						</FieldRow>
					</div>

					{/* Polling */}
					<div className="flex flex-col gap-4">
						<SectionDivider title="Polling" />
						<FieldRow label="Polling Interval" description="Board refresh interval (seconds)">
							<NumberInput
								value={config.pollingIntervalSeconds}
								onChange={(v) => setConfig({ ...config, pollingIntervalSeconds: v })}
							/>
						</FieldRow>
						<FieldRow label="PR Poll Interval" description="PR status check interval (seconds)">
							<NumberInput
								value={config.prPollingIntervalSeconds}
								onChange={(v) => setConfig({ ...config, prPollingIntervalSeconds: v })}
							/>
						</FieldRow>
					</div>

					<SaveButton saving={saving} onSave={handleSave} />
				</div>
			</div>
		</div>
	);
}
