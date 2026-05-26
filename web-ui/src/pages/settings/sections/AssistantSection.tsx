import { Textarea } from "@geckoui/geckoui";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { Field, SaveRow, SectionHeader } from "../_shared";

export function AssistantSection({
	config,
	saving,
	onUpdate,
	onSave,
}: {
	config: RuntimeProjectConfig;
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	return (
		<>
			<SectionHeader
				title="Assistant"
				description="Shared context appended to every agent — dev, code review, QA, and the Assistant chat. Use it for tech stack details, project goals, website URLs, or any information all agents should know."
			/>
			<Field label="Shared system prompt">
				<Textarea
					value={config.systemPrompt ?? ""}
					onChange={(e) => onUpdate({ ...config, systemPrompt: e.target.value || undefined })}
					placeholder={
						"Tech stack: Next.js, TypeScript, Postgres\nWebsite: https://example.com\nGoals: keep bundle size under 200kb, follow REST conventions"
					}
					maxRows={20}
					autoResize
				/>
			</Field>
			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}
