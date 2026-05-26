import { toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, RuntimeProjectConfig, RuntimeProjectSecret } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";
import { type ProjectSection } from "./_shared";
import { WorkflowsSection } from "./workflows";
import { EnvironmentSection } from "./EnvironmentSection";
import { SecretsSection } from "./SecretsSection";
import { AutonomousSection } from "./sections/AutonomousSection";
import { AssistantSection } from "./sections/AssistantSection";
import { GitSection } from "./sections/GitSection";
import { JiraSection } from "./sections/JiraSection";

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
		if (section === "git") {
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

	if (!config) {
		return <div className="flex items-center justify-center py-20 text-gray-500 text-sm">Loading...</div>;
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
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-xl space-y-6">
				{section === "autonomous" && (
					<AutonomousSection
						config={config}
						saving={saving}
						togglingAutonomous={togglingAutonomous}
						onToggleAutonomous={handleToggleAutonomous}
						onUpdate={updateConfig}
						onSave={handleSave}
					/>
				)}

				{section === "assistant" && (
					<AssistantSection config={config} saving={saving} onUpdate={updateConfig} onSave={handleSave} />
				)}

				{section === "environment" && (
					<EnvironmentSection
						workspaceId={workspaceId}
						setup={config.worktreeSetup ?? { filesToCopy: [], installCommand: "" }}
						onChange={(worktreeSetup) => updateConfig({ ...config, worktreeSetup })}
						startCommand={config.startCommand ?? ""}
						onStartCommandChange={(startCommand) => updateConfig({ ...config, startCommand })}
						onSave={handleSave}
						saving={saving}
					/>
				)}

				{section === "secrets" && (
					<SecretsSection
						secrets={config.secrets ?? []}
						onChange={(secrets) => updateConfig({ ...config, secrets })}
						onSave={handleSaveSecrets}
						saving={saving}
					/>
				)}

				{section === "git" && (
					<GitSection
						config={config}
						branches={branches}
						saving={saving}
						onUpdate={updateConfig}
						onSave={handleSave}
					/>
				)}

				{section === "jira" && (
					<JiraSection
						workspaceId={workspaceId}
						config={config}
						saving={saving}
						onUpdate={updateConfig}
						onSave={handleSave}
					/>
				)}
			</div>
		</div>
	);
}
