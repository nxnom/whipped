import { Switch } from "@geckoui/geckoui";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { BranchSelect } from "@/components/BranchSelect";
import { SaveRow } from "../_shared";

function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-sm font-semibold" style={{ color: "#f0f0f5" }}>
				{title}
			</span>
			<div className="flex-1" style={{ height: 1, background: "#2a2a35" }} />
		</div>
	);
}

function FieldRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-4">
			<div className="flex-1 flex flex-col gap-0.5">
				<span className="text-[13px] font-medium" style={{ color: "#f0f0f5" }}>
					{label}
				</span>
				<span className="text-[11px]" style={{ color: "#4a4a5a" }}>
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
	placeholder,
}: {
	value: number | undefined;
	onChange: (v: number | undefined) => void;
	placeholder?: string;
}) {
	return (
		<input
			type="number"
			value={value ?? ""}
			onChange={(e) => {
				const v = e.target.value;
				onChange(v ? Math.max(0, Number(v)) : undefined);
			}}
			placeholder={placeholder ?? "Global"}
			className="text-center font-mono text-[13px] font-medium focus:outline-none focus:border-[#7c6aff]"
			style={{
				width: 64,
				height: 32,
				background: "#1a1a1f",
				border: "1px solid #2a2a35",
				borderRadius: 6,
				color: "#f0f0f5",
			}}
		/>
	);
}

export function GeneralAutomationSection({
	config,
	branches,
	saving,
	togglingAutonomous,
	onToggleAutonomous,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	branches: string[];
	saving: boolean;
	togglingAutonomous: boolean;
	onToggleAutonomous: () => void;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	return (
		<div className="flex flex-col gap-7">
			{/* Automation */}
			<div className="flex flex-col gap-4">
				<SectionDivider title="Automation" />
				<FieldRow label="Autonomous mode" description="Automatically pick up Ready and Reopened tasks when idle.">
					<Switch checked={config.autonomousModeEnabled} onChange={onToggleAutonomous} disabled={togglingAutonomous} />
				</FieldRow>
				<FieldRow label="Auto PR" description="Push branch and open PR when all reviews pass.">
					<Switch checked={config.autoPR ?? false} onChange={(v) => onUpdate({ ...config, autoPR: v })} />
				</FieldRow>
				<FieldRow label="Auto commit" description="Commit pending changes automatically when merging or creating a PR.">
					<Switch checked={config.autoCommit ?? true} onChange={(v) => onUpdate({ ...config, autoCommit: v })} />
				</FieldRow>
			</div>

			{/* Runtime */}
			<div className="flex flex-col gap-4">
				<SectionDivider title="Runtime" />
				<FieldRow label="Max parallel tasks" description="Maximum tasks in progress at once. Overrides global default.">
					<NumberInput value={config.maxParallelTasks} onChange={(v) => onUpdate({ ...config, maxParallelTasks: v })} />
				</FieldRow>
				<FieldRow label="Max auto-fix attempts" description="Times an agent retries after a failing review.">
					<NumberInput
						value={config.maxAutoFixAttempts}
						onChange={(v) => onUpdate({ ...config, maxAutoFixAttempts: v })}
					/>
				</FieldRow>
				<FieldRow label="Polling interval (s)" description="Seconds between status checks.">
					<NumberInput
						value={config.pollingIntervalSeconds}
						onChange={(v) => onUpdate({ ...config, pollingIntervalSeconds: v })}
					/>
				</FieldRow>
			</div>

			{/* Git Defaults */}
			<div className="flex flex-col gap-4">
				<SectionDivider title="Git Defaults" />
				<FieldRow label="Default base branch" description="Used when creating new tasks and stories.">
					<div style={{ width: 160 }}>
						<BranchSelect
							branches={branches}
							value={config.defaultBaseBranch ?? ""}
							onChange={(v) => onUpdate({ ...config, defaultBaseBranch: v || undefined })}
							placeholder="main"
						/>
					</div>
				</FieldRow>
			</div>

			<SaveRow saving={saving} onSave={onSave} />
		</div>
	);
}
