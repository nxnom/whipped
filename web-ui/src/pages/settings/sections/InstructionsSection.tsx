import type { RuntimeProjectConfig } from "@runtime-contract";
import { DEFAULT_GIT_INSTRUCTIONS } from "@runtime-contract";
import { RotateCcw } from "lucide-react";

function SectionDivider({ title, action }: { title: string; action?: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2">
			<span className="text-[15px] font-semibold shrink-0" style={{ color: "#f0f0f5" }}>
				{title}
			</span>
			<div className="flex-1" style={{ height: 1, background: "#1a1a1f" }} />
			{action}
		</div>
	);
}

const textareaStyle: React.CSSProperties = {
	background: "#0c0c0f",
	border: "1px solid #2a2a35",
	borderRadius: 8,
	padding: "14px 16px",
	color: "#c0c0d0",
	fontFamily: "JetBrains Mono, monospace",
	fontSize: 12,
	lineHeight: 1.5,
	resize: "none",
	outline: "none",
	width: "100%",
};

export function InstructionsSection({
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
		<div className="flex flex-col h-full">
			<div className="flex-1 flex flex-col gap-7 px-10 py-6 min-h-0">
				{/* Shared System Prompt */}
				<div className="flex flex-col gap-3 shrink-0">
					<SectionDivider title="Shared System Prompt" />
					<p className="text-[12px]" style={{ color: "#60607a" }}>
						Appended to all agents (dev, code review, QA, assistant). Use for tech stack, project goals, or any context
						all agents should know.
					</p>
					<textarea
						value={config.systemPrompt ?? ""}
						onChange={(e) => onUpdate({ ...config, systemPrompt: e.target.value || undefined })}
						placeholder={
							"Tech stack: Next.js 15, TypeScript, Postgres\nWebsite: https://app.example.com\n\nGoals:\n- Keep bundle size under 200kb\n- Follow REST conventions"
						}
						style={{ ...textareaStyle, height: 180 }}
					/>
				</div>

				{/* Git Conventions */}
				<div className="flex flex-col gap-3 flex-1 min-h-0">
					<SectionDivider
						title="Git Conventions"
						action={
							<button
								onClick={() => onUpdate({ ...config, gitInstructions: DEFAULT_GIT_INSTRUCTIONS })}
								className="flex items-center gap-1.5 hover:opacity-80 transition-opacity shrink-0"
								style={{
									border: "1px solid #2a2a35",
									borderRadius: 5,
									padding: "5px 10px",
									background: "transparent",
									color: "#8888a0",
								}}
							>
								<RotateCcw size={12} />
								<span className="text-[11px]">Load Default</span>
							</button>
						}
					/>
					<p className="text-[12px] shrink-0" style={{ color: "#60607a" }}>
						Custom rules for commit messages, PR titles, and PR descriptions. The dev agent reads these when writing git
						messages.
					</p>
					<textarea
						value={config.gitInstructions ?? ""}
						onChange={(e) => onUpdate({ ...config, gitInstructions: e.target.value || undefined })}
						placeholder={DEFAULT_GIT_INSTRUCTIONS}
						style={{ ...textareaStyle, flex: 1 }}
					/>
				</div>
			</div>

			{/* Save */}
			<div className="shrink-0 flex justify-end px-10 py-4" style={{ borderTop: "1px solid #2a2a35" }}>
				<button
					onClick={onSave}
					disabled={saving}
					className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
					style={{ background: "#7c6aff", color: "#ffffff" }}
				>
					{saving ? "Saving..." : "Save"}
				</button>
			</div>
		</div>
	);
}
