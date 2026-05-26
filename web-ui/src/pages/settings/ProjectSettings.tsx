import { toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, RuntimeProjectConfig, RuntimeProjectSecret } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";
import { type ProjectSection } from "./_shared";
import { WorkflowsSection } from "./workflows";
import { EnvironmentSection } from "./EnvironmentSection";
import { SecretsSection } from "./SecretsSection";
import { GeneralAutomationSection } from "./sections/GeneralAutomationSection";
import { AssistantSection } from "./sections/AssistantSection";
import { GitSection } from "./sections/GitSection";
import { JiraSection } from "./sections/JiraSection";

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

const SECTION_META: Record<ProjectSection, { title: string; description: string }> = {
	"general-automation": {
		title: "General & Automation",
		description: "Configure autonomous behaviors and runtime defaults for this project.",
	},
	workflows: {
		title: "Workflows",
		description: "Define agent pipelines for tasks and stories.",
	},
	environment: {
		title: "Environment & Secrets",
		description: "Configure worktree setup and manage secrets for agents.",
	},
	instructions: {
		title: "Instructions",
		description: "Configure shared prompts and conventions for all agents.",
	},
	integrations: {
		title: "Integrations",
		description: "Connect external services to import tickets and sync data.",
	},
};

export function ProjectSettings({ workspaceId, section }: { workspaceId: string; section: ProjectSection }) {
	const [config, setConfig] = useState<RuntimeProjectConfig | null>(null);
	const [globalDefaultBinary, setGlobalDefaultBinary] = useState<RuntimeAgentId>("claude");
	const [saving, setSaving] = useState(false);
	const [togglingAutonomous, setTogglingAutonomous] = useState(false);
	const [branches, setBranches] = useState<string[]>([]);
	const isDirtyRef = useRef(false);

	const { state: wsState } = useWorkspaceState(workspaceId);

	useEffect(() => {
		trpc.config.get
			.query()
			.then((g) => setGlobalDefaultBinary(g.defaultAgent as "claude" | "codex"))
			.catch(() => {});
	}, []);

	useEffect(() => {
		if (section === "general-automation" || section === "instructions") {
			trpc.cards.listBranches
				.query({ workspaceId })
				.then(({ branches: b }) => setBranches(b))
				.catch(() => {});
		}
	}, [section, workspaceId]);

	useEffect(() => {
		setConfig(null);
		isDirtyRef.current = false;
	}, [workspaceId]);

	useEffect(() => {
		if (wsState?.projectConfig && !isDirtyRef.current) {
			setConfig(wsState.projectConfig);
		}
	}, [wsState?.projectConfig]);

	const updateConfig = (next: RuntimeProjectConfig) => {
		isDirtyRef.current = true;
		setConfig(next);
	};

	const handleToggleAutonomous = async () => {
		if (!config) return;
		const next = !config.autonomousModeEnabled;
		setTogglingAutonomous(true);
		try {
			await trpc.workspace.setAutonomousMode.mutate({ workspaceId, enabled: next });
			updateConfig({ ...config, autonomousModeEnabled: next });
			toast.success(next ? "Autonomous mode on" : "Autonomous mode off");
		} catch {
			toast.error("Failed to toggle autonomous mode");
		} finally {
			setTogglingAutonomous(false);
		}
	};

	const handleSave = async () => {
		if (!config) return;
		setSaving(true);
		try {
			await trpc.projectConfig.save.mutate({ workspaceId, config });
			isDirtyRef.current = false;
			toast.success("Project settings saved");
		} catch {
			toast.error("Failed to save project settings");
		} finally {
			setSaving(false);
		}
	};

	const handleSaveSecrets = async (secrets: RuntimeProjectSecret[]) => {
		if (!config) return;
		const next = { ...config, secrets };
		updateConfig(next);
		setSaving(true);
		try {
			await trpc.projectConfig.save.mutate({ workspaceId, config: next });
			isDirtyRef.current = false;
			toast.success("Secrets saved");
		} catch {
			toast.error("Failed to save secrets");
		} finally {
			setSaving(false);
		}
	};

	const meta = SECTION_META[section];

	if (!config) {
		return (
			<div className="flex-1 flex flex-col">
				<PageHeader title={meta.title} description={meta.description} />
				<div className="flex items-center justify-center py-20 text-sm" style={{ color: "#60607a" }}>
					Loading...
				</div>
			</div>
		);
	}

	if (section === "workflows") {
		return (
			<WorkflowsSection
				workflows={config.workflows}
				workspaceId={workspaceId}
				defaultBinary={globalDefaultBinary}
				onChange={(workflows) => updateConfig({ ...config, workflows })}
			/>
		);
	}

	return (
		<div className="flex-1 flex flex-col overflow-hidden">
			<PageHeader title={meta.title} description={meta.description} />
			<div className="flex-1 overflow-y-auto px-10 py-6">
				{section === "general-automation" && (
					<GeneralAutomationSection
						config={config}
						branches={branches}
						saving={saving}
						togglingAutonomous={togglingAutonomous}
						onToggleAutonomous={handleToggleAutonomous}
						onUpdate={updateConfig}
						onSave={handleSave}
					/>
				)}

				{section === "environment" && (
					<div className="max-w-xl space-y-6">
						<EnvironmentSection
							workspaceId={workspaceId}
							setup={config.worktreeSetup ?? { filesToCopy: [], installCommand: "" }}
							onChange={(worktreeSetup) => updateConfig({ ...config, worktreeSetup })}
							startCommand={config.startCommand ?? ""}
							onStartCommandChange={(startCommand) => updateConfig({ ...config, startCommand })}
							onSave={handleSave}
							saving={saving}
						/>
						<div style={{ borderTop: "1px solid #2a2a35" }} className="pt-6">
							<SecretsSection
								secrets={config.secrets ?? []}
								onChange={(secrets) => updateConfig({ ...config, secrets })}
								onSave={handleSaveSecrets}
								saving={saving}
							/>
						</div>
					</div>
				)}

				{section === "instructions" && (
					<div className="max-w-xl space-y-6">
						<AssistantSection config={config} saving={saving} onUpdate={updateConfig} onSave={handleSave} />
						<div style={{ borderTop: "1px solid #2a2a35" }} className="pt-6">
							<GitSection
								config={config}
								branches={branches}
								saving={saving}
								onUpdate={updateConfig}
								onSave={handleSave}
							/>
						</div>
					</div>
				)}

				{section === "integrations" && (
					<div className="max-w-xl space-y-6">
						<JiraSection
							workspaceId={workspaceId}
							config={config}
							saving={saving}
							onUpdate={updateConfig}
							onSave={handleSave}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
