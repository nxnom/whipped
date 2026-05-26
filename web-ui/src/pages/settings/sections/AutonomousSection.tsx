import { Input, Switch } from "@geckoui/geckoui";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { SaveRow, SectionHeader } from "../_shared";

export function AutonomousSection({
	config,
	saving,
	togglingAutonomous,
	onToggleAutonomous,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	saving: boolean;
	togglingAutonomous: boolean;
	onToggleAutonomous: () => void;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	return (
		<>
			<SectionHeader title="Automation" description="Configure automatic behaviors for this project." />
			<div className="space-y-3">
				<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
					<div>
						<p className="text-sm font-medium text-gray-100">Autonomous mode</p>
						<p className="text-xs text-gray-500 mt-0.5">
							Picks up <span className="text-emerald-400">Ready</span> and{" "}
							<span className="text-orange-400">Reopened</span> tasks automatically
						</p>
					</div>
					<Switch checked={config.autonomousModeEnabled} onChange={onToggleAutonomous} disabled={togglingAutonomous} />
				</div>

				<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
					<div>
						<p className="text-sm font-medium text-gray-100">Auto PR</p>
						<p className="text-xs text-gray-500 mt-0.5">
							Automatically push branch and open a <span className="text-green-400">Pull Request</span> when all reviews
							pass
						</p>
					</div>
					<Switch checked={config.autoPR ?? false} onChange={(v) => onUpdate({ ...config, autoPR: v })} />
				</div>

				<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
					<div>
						<p className="text-sm font-medium text-gray-100">Auto commit</p>
						<p className="text-xs text-gray-500 mt-0.5">
							Automatically commit any pending changes when merging or creating a PR. When off, you will be asked for a
							commit message if there are uncommitted changes.
						</p>
					</div>
					<Switch checked={config.autoCommit ?? true} onChange={(v) => onUpdate({ ...config, autoCommit: v })} />
				</div>

				<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
					<div>
						<p className="text-sm font-medium text-gray-100">Max parallel tasks</p>
						<p className="text-xs text-gray-500 mt-0.5">
							Max tasks in <span className="text-blue-400">In Progress</span> at once. Overrides the global default.
						</p>
					</div>
					<Input
						type="number"
						inputClassName="w-16 text-center"
						value={config.maxParallelTasks != null ? String(config.maxParallelTasks) : ""}
						onChange={(e) => {
							const v = e.target.value;
							onUpdate({ ...config, maxParallelTasks: v ? Math.max(1, Number(v)) : undefined });
						}}
						placeholder="Global"
					/>
				</div>
			</div>
			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}
