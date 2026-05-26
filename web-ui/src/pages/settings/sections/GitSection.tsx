import { Button, Textarea } from "@geckoui/geckoui";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { DEFAULT_GIT_INSTRUCTIONS } from "@runtime-contract";
import { BranchSelect } from "@/components/BranchSelect";
import { Field, SaveRow, SectionHeader } from "../_shared";

export function GitSection({
	config,
	branches,
	saving,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	branches: string[];
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	return (
		<>
			<SectionHeader title="Git" description="Repository defaults used when creating new tickets." />
			<Field label="Default base branch">
				<BranchSelect
					branches={branches}
					value={config.defaultBaseBranch ?? ""}
					onChange={(v) => onUpdate({ ...config, defaultBaseBranch: v || undefined })}
					placeholder="Use repo default"
				/>
				<p className="text-xs text-gray-500 mt-1.5">
					New tasks and stories will default to this branch. Leave empty to use the repo's default branch.
				</p>
			</Field>
			<Field label="Git conventions">
				<Textarea
					value={config.gitInstructions ?? ""}
					onChange={(e) => onUpdate({ ...config, gitInstructions: e.target.value || undefined })}
					placeholder={DEFAULT_GIT_INSTRUCTIONS}
					maxRows={30}
					autoResize
				/>
				<div className="flex items-center gap-3 mt-1.5">
					<p className="text-xs text-gray-500 flex-1">
						Freeform rules the dev agent reads when writing commit messages, PR titles, and PR descriptions. Leave empty
						to use the built-in default shown as placeholder.
					</p>
					{!config.gitInstructions && (
						<Button
							variant="outlined"
							size="sm"
							onClick={() => onUpdate({ ...config, gitInstructions: DEFAULT_GIT_INSTRUCTIONS })}
						>
							Load default
						</Button>
					)}
				</div>
			</Field>
			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}
