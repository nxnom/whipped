import { toast } from "@geckoui/geckoui";
import type { RuntimeAgentId, RuntimeProjectConfig, RuntimeProjectSecret } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import { useRead, useWrite } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import type { ProjectSection } from "./_shared";
import { WorkflowsSection } from "./workflows";
import { EnvironmentSecretsSection } from "./EnvironmentSecretsSection";
import { MemorySection } from "./sections/MemorySection";
import { GeneralAutomationSection } from "./sections/GeneralAutomationSection";
import { InstructionsSection } from "./sections/InstructionsSection";

function PageHeader({ title, description }: { title: string; description: string }) {
	return (
		<div className="shrink-0 flex flex-col gap-1 px-10 py-6 border-b border-[#2a2a35]">
			<h1 className="text-xl font-semibold text-[#f0f0f5]">{title}</h1>
			<p className="text-[13px] text-[#60607a]">{description}</p>
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
	memory: {
		title: "Memory",
		description: "Durable knowledge agents recall so they stop re-discovering the same facts.",
	},
};

export function ProjectSettings({ workspaceId, section }: { workspaceId: string; section: ProjectSection }) {
	const [config, setConfig] = useState<RuntimeProjectConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const isDirtyRef = useRef(false);

	const { state: wsState } = useWorkspaceState(workspaceId);

	const { data: globalConfig } = useRead((api) => api("config").GET());
	const { data: branchesData } = useRead((api) => api("cards/branches").GET({ query: { workspaceId } }), {
		enabled: section === "general-automation" || section === "instructions",
	});
	const { trigger: saveProjectConfig } = useWrite((api) => api("project-config").PUT());

	// Derive directly from the cached reads — never mirror Spoosh data into local
	// state via an effect (its reference changes each render → setState loop).
	const globalDefaultBinary = (globalConfig?.defaultAgent ?? "claude") as RuntimeAgentId;
	const branches = branchesData?.branches ?? [];

	useEffect(() => {
		setConfig(null);
		isDirtyRef.current = false;
	}, [workspaceId]);

	useEffect(() => {
		if (wsState?.projectConfig && config === null && !isDirtyRef.current) {
			setConfig(wsState.projectConfig);
		}
	}, [wsState?.projectConfig, config]);

	const updateConfig = (next: RuntimeProjectConfig) => {
		isDirtyRef.current = true;
		setConfig(next);
	};

	const handleSave = async () => {
		if (!config) return;
		setSaving(true);
		try {
			const res = await saveProjectConfig({ body: { workspaceId, config } });
			if (res.error) throw res.error;
			isDirtyRef.current = false;
			toast.success("Settings saved");
		} catch {
			toast.error("Failed to save settings");
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
			const res = await saveProjectConfig({ body: { workspaceId, config: next } });
			if (res.error) throw res.error;
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
				<div className="flex items-center justify-center py-20 text-sm text-[#60607a]">Loading...</div>
			</div>
		);
	}

	if (section === "workflows") {
		return (
			<WorkflowsSection
				workflows={config.workflows}
				workspaceId={workspaceId}
				repoPath={wsState?.repoPath ?? ""}
				defaultBinary={globalDefaultBinary}
				onChange={(workflows) => updateConfig({ ...config, workflows })}
			/>
		);
	}

	// Instructions fills the full height (textareas expand to fill remaining space)
	if (section === "instructions") {
		return (
			<div className="flex-1 flex flex-col overflow-hidden">
				<PageHeader title={meta.title} description={meta.description} />
				<InstructionsSection config={config} workspaceId={workspaceId} />
			</div>
		);
	}

	if (section === "memory") {
		return (
			<div className="flex-1 flex flex-col overflow-hidden">
				<PageHeader title={meta.title} description={meta.description} />
				<MemorySection workspaceId={workspaceId} />
			</div>
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
						onUpdate={updateConfig}
						onSave={handleSave}
					/>
				)}

				{section === "environment" && (
					<EnvironmentSecretsSection
						workspaceId={workspaceId}
						config={config}
						saving={saving}
						onUpdate={updateConfig}
						onSave={handleSave}
						onSaveSecrets={handleSaveSecrets}
					/>
				)}
			</div>
		</div>
	);
}
