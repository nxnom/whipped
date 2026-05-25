import { Button, Checkbox, Input, Select, SelectOption, Switch, Textarea, toast } from "@geckoui/geckoui";
import {
	DragDropContext,
	Draggable,
	type DraggableProvidedDragHandleProps,
	Droppable,
	type DropResult,
} from "@hello-pangea/dnd";
import type {
	RuntimeGlobalConfig,
	RuntimeJiraTicket,
	RuntimeProjectConfig,
	RuntimeProjectSecret,
	RuntimeWorktreeSetup,
	Workflow,
	WorkflowSlot,
} from "@runtime-contract";
import {
	AGENT_BINARY_OPTIONS,
	BUILTIN_SECRET_KEYS,
	DEFAULT_GIT_INSTRUCTIONS,
	EFFORT_OPTIONS,
	type EffortLevel,
	MODEL_OPTIONS,
	type RuntimeAgentId,
	workflowSchema,
} from "@runtime-contract";
import {
	ArrowLeft,
	Bot,
	Download,
	Eye,
	EyeOff,
	GitBranch,
	GripVertical,
	Key,
	Layers,
	MessageSquare,
	Plus,
	RefreshCw,
	Settings2,
	Terminal,
	Ticket,
	Trash2,
	Upload,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BranchSelect } from "@/components/BranchSelect";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";

type ProjectSection = "autonomous" | "workflows" | "assistant" | "environment" | "secrets" | "jira" | "git";
type GlobalSection = "general";
type SettingsSection = ProjectSection | GlobalSection;

const PROJECT_NAV: Array<{ id: ProjectSection; label: string; icon: React.ReactNode }> = [
	{ id: "autonomous", label: "Autonomous", icon: <Zap size={14} /> },
	{ id: "workflows", label: "Workflows", icon: <Bot size={14} /> },
	{ id: "assistant", label: "Assistant", icon: <MessageSquare size={14} /> },
	{ id: "environment", label: "Environment", icon: <Terminal size={14} /> },
	{ id: "git", label: "Git", icon: <GitBranch size={14} /> },
	{ id: "secrets", label: "Secrets", icon: <Key size={14} /> },
	{ id: "jira", label: "Jira", icon: <Ticket size={14} /> },
];

const GLOBAL_NAV: Array<{ id: GlobalSection; label: string; icon: React.ReactNode }> = [
	{ id: "general", label: "General", icon: <Settings2 size={14} /> },
];

const PROJECT_SECTIONS = new Set<SettingsSection>([
	"autonomous",
	"workflows",
	"assistant",
	"environment",
	"secrets",
	"jira",
	"git",
]);

export function SettingsPage() {
	const navigate = useNavigate();
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const [section, setSection] = useState<SettingsSection>("autonomous");
	const isProject = PROJECT_SECTIONS.has(section);
	if (!workspaceId) return null;

	return (
		<div className="flex-1 overflow-hidden flex flex-col">
			{/* Header */}
			<div className="shrink-0 border-b border-gray-800 px-4 h-10 flex items-center gap-3">
				<button
					onClick={() => navigate(`/${encodeURIComponent(workspaceId)}/board`)}
					className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
				>
					<ArrowLeft size={14} />
					Board
				</button>
				<span className="text-gray-700 text-sm">/</span>
				<span className="text-sm text-gray-300">Settings</span>
			</div>

			<div className="flex-1 overflow-hidden flex">
				{/* Sidebar nav */}
				<nav className="w-44 shrink-0 border-r border-gray-800 py-4 overflow-y-auto">
					<NavGroup label="Project" items={PROJECT_NAV} activeId={section} onSelect={setSection} />
					<NavGroup label="Global" items={GLOBAL_NAV} activeId={section} onSelect={setSection} />
				</nav>

				{/* Content */}
				<div className="flex-1 overflow-hidden">
					{isProject ? (
						<ProjectSettings workspaceId={workspaceId} section={section as ProjectSection} />
					) : (
						<GlobalSettings section={section as GlobalSection} />
					)}
				</div>
			</div>
		</div>
	);
}

function NavGroup({
	label,
	items,
	activeId,
	onSelect,
}: {
	label: string;
	items: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }>;
	activeId: string;
	onSelect: (id: SettingsSection) => void;
}) {
	return (
		<div className="mb-5">
			<p className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
			{items.map((item) => (
				<button
					key={item.id}
					onClick={() => onSelect(item.id)}
					className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors
						${activeId === item.id ? "text-white bg-gray-800" : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"}`}
				>
					{item.icon}
					{item.label}
				</button>
			))}
		</div>
	);
}

// ─── Project Settings ───────────────────────────────────────────────────────

function ProjectSettings({ workspaceId, section }: { workspaceId: string; section: ProjectSection }) {
	const [config, setConfig] = useState<RuntimeProjectConfig | null>(null);
	const [globalDefaultBinary, setGlobalDefaultBinary] = useState<"claude" | "codex">("claude");
	const [saving, setSaving] = useState(false);
	const [togglingAutonomous, setTogglingAutonomous] = useState(false);
	const [jiraTickets, setJiraTickets] = useState<RuntimeJiraTicket[] | null>(null);
	const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
	const [fetchingJira, setFetchingJira] = useState(false);
	const [importing, setImporting] = useState(false);
	const [branches, setBranches] = useState<string[]>([]);
	const isDirtyRef = useRef(false);

	const { state: wsState } = useWorkspaceState(workspaceId);

	// Initial load of global config
	useEffect(() => {
		trpc.config.get
			.query()
			.then((g) => setGlobalDefaultBinary(g.defaultAgent as "claude" | "codex"))
			.catch(() => {});
	}, []);

	// Fetch branches when git section is active
	useEffect(() => {
		if (section === "git") {
			trpc.cards.listBranches
				.query({ workspaceId })
				.then(({ branches: b }) => setBranches(b))
				.catch(() => {});
		}
	}, [section, workspaceId]);

	// Reset dirty flag when workspace changes
	useEffect(() => {
		setConfig(null);
		isDirtyRef.current = false;
	}, [workspaceId]);

	// Sync config from live workspace state when not locally edited
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

	const handleFetchJira = async () => {
		setFetchingJira(true);
		setJiraTickets(null);
		try {
			const tickets = await trpc.jira.fetchTickets.query({ workspaceId });
			setJiraTickets(tickets);
		} catch {
			toast.error("Failed to fetch Jira tickets. Check your Jira configuration.");
		} finally {
			setFetchingJira(false);
		}
	};

	const handleImport = async () => {
		if (selectedTickets.size === 0) return;
		setImporting(true);
		try {
			const result = await trpc.jira.importTickets.mutate({
				workspaceId,
				ticketKeys: Array.from(selectedTickets),
			});
			toast.success(`Imported ${result.created.length} tickets`);
			setJiraTickets(null);
			setSelectedTickets(new Set());
		} catch {
			toast.error("Failed to import tickets");
		} finally {
			setImporting(false);
		}
	};

	if (!config) {
		return <div className="flex items-center justify-center py-20 text-gray-500 text-sm">Loading...</div>;
	}

	if (section === "workflows") {
		return (
			<WorkflowsSection
				workflows={config.workflows}
				defaultBinary={globalDefaultBinary}
				onChange={(workflows) => updateConfig({ ...config, workflows })}
				onSave={handleSave}
				saving={saving}
			/>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-xl space-y-6">
				{section === "autonomous" && (
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
								<Switch
									checked={config.autonomousModeEnabled}
									onChange={handleToggleAutonomous}
									disabled={togglingAutonomous}
								/>
							</div>

							<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
								<div>
									<p className="text-sm font-medium text-gray-100">Auto PR</p>
									<p className="text-xs text-gray-500 mt-0.5">
										Automatically push branch and open a <span className="text-green-400">Pull Request</span> when all
										reviews pass
									</p>
								</div>
								<Switch checked={config.autoPR ?? false} onChange={(v) => updateConfig({ ...config, autoPR: v })} />
							</div>

							<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
								<div>
									<p className="text-sm font-medium text-gray-100">Max parallel tasks</p>
									<p className="text-xs text-gray-500 mt-0.5">
										Max tasks in <span className="text-blue-400">In Progress</span> at once. Overrides the global
										default.
									</p>
								</div>
								<Input
									type="number"
									inputClassName="w-16 text-center"
									value={config.maxParallelTasks != null ? String(config.maxParallelTasks) : ""}
									onChange={(e) => {
										const v = e.target.value;
										updateConfig({ ...config, maxParallelTasks: v ? Math.max(1, Number(v)) : undefined });
									}}
									placeholder="Global"
								/>
							</div>
						</div>
						<SaveRow saving={saving} onSave={handleSave} />
					</>
				)}

				{section === "assistant" && (
					<>
						<SectionHeader
							title="Assistant"
							description="Shared context appended to every agent — dev, code review, QA, and the Assistant chat. Use it for tech stack details, project goals, website URLs, or any information all agents should know."
						/>
						<Field label="Shared system prompt">
							<Textarea
								value={config.systemPrompt ?? ""}
								onChange={(e) => updateConfig({ ...config, systemPrompt: e.target.value || undefined })}
								placeholder={
									"Tech stack: Next.js, TypeScript, Postgres\nWebsite: https://example.com\nGoals: keep bundle size under 200kb, follow REST conventions"
								}
								maxRows={20}
								autoResize
							/>
						</Field>
						<SaveRow saving={saving} onSave={handleSave} />
					</>
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
						onSave={handleSave}
						saving={saving}
					/>
				)}

				{section === "git" && (
					<>
						<SectionHeader title="Git" description="Repository defaults used when creating new tickets." />
						<Field label="Default base branch">
							<BranchSelect
								branches={branches}
								value={config.defaultBaseBranch ?? ""}
								onChange={(v) => updateConfig({ ...config, defaultBaseBranch: v || undefined })}
								placeholder="Use repo default"
							/>
							<p className="text-xs text-gray-500 mt-1.5">
								New tasks and stories will default to this branch. Leave empty to use the repo's default branch.
							</p>
						</Field>
						<Field label="Git conventions">
							<Textarea
								value={config.gitInstructions ?? ""}
								onChange={(e) => updateConfig({ ...config, gitInstructions: e.target.value || undefined })}
								placeholder={DEFAULT_GIT_INSTRUCTIONS}
								maxRows={30}
								autoResize
							/>
							<div className="flex items-center gap-3 mt-1.5">
								<p className="text-xs text-gray-500 flex-1">
									Freeform rules the dev agent reads when writing commit messages, PR titles, and PR descriptions.
									Leave empty to use the built-in default shown as placeholder.
								</p>
								{!config.gitInstructions && (
									<Button
										variant="outlined"
										size="sm"
										onClick={() => updateConfig({ ...config, gitInstructions: DEFAULT_GIT_INSTRUCTIONS })}
									>
										Load default
									</Button>
								)}
							</div>
						</Field>
						<SaveRow saving={saving} onSave={handleSave} />
					</>
				)}

				{section === "jira" && (
					<>
						<SectionHeader
							title="Jira"
							description="Connect your Jira project to import tickets directly onto the board."
						/>
						<div className="space-y-4">
							<Field label="Host">
								<Input
									value={config.jira?.host ?? ""}
									onChange={(e) => updateConfig({ ...config, jira: { ...config.jira!, host: e.target.value } })}
									placeholder="company.atlassian.net"
								/>
							</Field>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Email">
									<Input
										value={config.jira?.email ?? ""}
										onChange={(e) => updateConfig({ ...config, jira: { ...config.jira!, email: e.target.value } })}
										placeholder="you@company.com"
									/>
								</Field>
								<Field label="API Token">
									<Input
										type="password"
										value={config.jira?.token ?? ""}
										onChange={(e) => updateConfig({ ...config, jira: { ...config.jira!, token: e.target.value } })}
										placeholder="••••••••"
									/>
								</Field>
							</div>
							<Field label="Project Key">
								<Input
									value={config.jira?.projectKey ?? ""}
									onChange={(e) => updateConfig({ ...config, jira: { ...config.jira!, projectKey: e.target.value } })}
									placeholder="ENG"
								/>
							</Field>
						</div>
						<SaveRow saving={saving} onSave={handleSave} />

						{/* Import tickets */}
						<div className="pt-2">
							<div className="border-t border-gray-800 pt-5">
								<div className="flex items-center justify-between mb-3">
									<div>
										<p className="text-sm font-medium text-gray-200">Import Tickets</p>
										<p className="text-xs text-gray-500 mt-0.5">Fetch and import open tickets from your project</p>
									</div>
									<Button
										variant="outlined"
										size="sm"
										onClick={handleFetchJira}
										disabled={fetchingJira || !config.jira?.host}
									>
										<RefreshCw size={12} className={`mr-1.5 ${fetchingJira ? "animate-spin" : ""}`} />
										Fetch tickets
									</Button>
								</div>

								{jiraTickets && (
									<div className="space-y-2">
										<div className="max-h-64 overflow-y-auto space-y-1.5 rounded-xl border border-gray-800 p-2">
											{jiraTickets.map((ticket) => (
												<label
													key={ticket.key}
													className="flex items-start gap-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg p-2.5 cursor-pointer transition-colors"
												>
													<Checkbox
														checked={selectedTickets.has(ticket.key)}
														onChange={(e) => {
															const next = new Set(selectedTickets);
															if (e.target.checked) next.add(ticket.key);
															else next.delete(ticket.key);
															setSelectedTickets(next);
														}}
														className="mt-0.5"
													/>
													<div className="min-w-0">
														<p className="text-xs text-gray-200 font-medium">
															<span className="text-blue-400">{ticket.key}</span> · {ticket.summary}
														</p>
														<p className="text-xs text-gray-500 mt-0.5">{ticket.status}</p>
													</div>
												</label>
											))}
										</div>

										{jiraTickets.length > 0 && (
											<div className="flex justify-between items-center pt-1">
												<p className="text-xs text-gray-500">{selectedTickets.size} selected</p>
												<Button size="sm" onClick={handleImport} disabled={selectedTickets.size === 0 || importing}>
													<Download size={12} className="mr-1.5" />
													{importing ? "Importing..." : `Import ${selectedTickets.size}`}
												</Button>
											</div>
										)}
									</div>
								)}
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// ─── Workflows Section ───────────────────────────────────────────────────────

function WorkflowsSection({
	workflows,
	defaultBinary,
	onChange,
	onSave,
	saving,
}: {
	workflows: Workflow[];
	defaultBinary: "claude" | "codex";
	onChange: (workflows: Workflow[]) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);

	const [activeTab, setActiveTab] = useState<"task" | "story">("task");
	const [selectedId, setSelectedId] = useState<string>(
		taskWorkflows.find((w) => w.isDefault)?.id ?? taskWorkflows[0]?.id ?? "",
	);
	const [editingSlot, setEditingSlot] = useState<{ wfId: string; slot: WorkflowSlot } | null>(null);
	const [addingCustomTo, setAddingCustomTo] = useState<string | null>(null);
	const [addingOrchTo, setAddingOrchTo] = useState<string | null>(null);

	const visibleWorkflows = activeTab === "task" ? taskWorkflows : storyWorkflows;
	const selectedWorkflow = workflows.find((w) => w.id === selectedId);

	const handleTabSwitch = (tab: "task" | "story") => {
		setActiveTab(tab);
		const list = tab === "task" ? taskWorkflows : storyWorkflows;
		setSelectedId(list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? "");
	};

	const updateWorkflow = (updated: Workflow) => {
		onChange(workflows.map((w) => (w.id === updated.id ? updated : w)));
	};

	const handleAddWorkflow = () => {
		const id = `wf_${Date.now()}`;
		const newWf: Workflow = {
			id,
			name: "New Workflow",
			isDefault: false,
			forStory: false,
			slots: [{ id: "dev", type: "dev", name: "Dev", agentBinary: defaultBinary, order: 0, enabled: true, prompt: "" }],
		};
		onChange([...workflows, newWf]);
		setActiveTab("task");
		setSelectedId(id);
	};

	const handleAddStoryWorkflow = () => {
		const id = `wf_story_${Date.now()}`;
		const newWf: Workflow = {
			id,
			name: "New Story Workflow",
			isDefault: false,
			forStory: true,
			slots: [
				{
					id: "orch",
					type: "orch",
					name: "Orchestrator",
					agentBinary: defaultBinary,
					order: 0,
					enabled: true,
					prompt: "",
				},
			],
		};
		onChange([...workflows, newWf]);
		setActiveTab("story");
		setSelectedId(id);
	};

	const handleDeleteWorkflow = (workflowId: string) => {
		const updated = workflows.filter((w) => w.id !== workflowId);
		onChange(updated);
		if (selectedId === workflowId) {
			const remaining = updated.filter((w) => (activeTab === "task" ? !w.forStory : w.forStory));
			setSelectedId(remaining.find((w) => w.isDefault)?.id ?? remaining[0]?.id ?? "");
		}
	};

	const importFileRef = useRef<HTMLInputElement>(null);

	const handleExport = (wf: Workflow) => {
		const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${wf.name.toLowerCase().replace(/\s+/g, "-")}.workflow.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const raw = JSON.parse(ev.target?.result as string);
				const parsed = workflowSchema.safeParse(raw);
				if (!parsed.success) {
					toast.error(`Invalid workflow file: ${parsed.error.issues[0]?.message}`);
					return;
				}
				const imported: Workflow = {
					...parsed.data,
					id: `wf_${Date.now()}`,
					isDefault: false,
				};
				onChange([...workflows, imported]);
				setActiveTab(imported.forStory ? "story" : "task");
				setSelectedId(imported.id);
				toast.success(`Imported "${imported.name}"`);
			} catch {
				toast.error("Failed to parse workflow file");
			}
		};
		reader.readAsText(file);
	};

	const handleSaveSlot = (updatedSlot: WorkflowSlot) => {
		if (!editingSlot) return;
		const wf = workflows.find((w) => w.id === editingSlot.wfId);
		if (!wf) return;
		updateWorkflow({ ...wf, slots: wf.slots.map((s) => (s.id === updatedSlot.id ? updatedSlot : s)) });
		setEditingSlot(null);
	};

	return (
		<div className="flex flex-col h-full">
			{/* Tab bar */}
			<div className="shrink-0 flex border-b border-gray-800">
				<button
					onClick={() => handleTabSwitch("task")}
					className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors
						${
							activeTab === "task"
								? "border-blue-500 text-white"
								: "border-transparent text-gray-500 hover:text-gray-300"
						}`}
				>
					<Bot size={13} />
					Task Workflows
					<span
						className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeTab === "task" ? "bg-blue-500/20 text-blue-400" : "bg-gray-800 text-gray-500"}`}
					>
						{taskWorkflows.length}
					</span>
				</button>
				<button
					onClick={() => handleTabSwitch("story")}
					className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors
						${
							activeTab === "story"
								? "border-purple-500 text-purple-200"
								: "border-transparent text-gray-500 hover:text-gray-300"
						}`}
				>
					<Layers size={13} />
					Story Workflows
					<span
						className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${activeTab === "story" ? "bg-purple-500/20 text-purple-400" : "bg-gray-800 text-gray-500"}`}
					>
						{storyWorkflows.length}
					</span>
				</button>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* Left: workflow list */}
				<div className="w-52 shrink-0 border-r border-gray-800 flex flex-col">
					<div className="flex-1 overflow-y-auto py-1">
						{visibleWorkflows.map((w) => (
							<button
								key={w.id}
								onClick={() => setSelectedId(w.id)}
								className={`w-full text-left flex items-center gap-2 px-4 py-2 text-sm transition-colors
								${
									selectedId === w.id
										? activeTab === "story"
											? "bg-purple-900/40 text-purple-200"
											: "bg-gray-800 text-white"
										: "text-gray-400 hover:text-gray-200 hover:bg-gray-900/50"
								}`}
							>
								{activeTab === "story" && <Layers size={12} className="shrink-0 text-purple-500" />}
								<span className="flex-1 truncate">{w.name}</span>
								{w.isDefault && <span className="text-[10px] text-gray-600 shrink-0">default</span>}
							</button>
						))}
						{visibleWorkflows.length === 0 && <p className="px-4 py-4 text-xs text-gray-600">No workflows yet</p>}
					</div>
					<div className="border-t border-gray-800 p-3 flex flex-col gap-0.5">
						<input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
						{activeTab === "task" ? (
							<button
								onClick={handleAddWorkflow}
								className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors px-1 py-1.5 rounded"
							>
								<Plus size={11} /> New Workflow
							</button>
						) : (
							<button
								onClick={handleAddStoryWorkflow}
								className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-purple-400 transition-colors px-1 py-1.5 rounded"
							>
								<Plus size={11} /> New Workflow
							</button>
						)}
						<button
							onClick={() => importFileRef.current?.click()}
							className="w-full text-left flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-400 transition-colors px-1 py-1.5 rounded"
						>
							<Upload size={11} /> Import Workflow
						</button>
					</div>
				</div>

				{/* Right: editor */}
				<div className="flex-1 overflow-hidden flex flex-col">
					{selectedWorkflow ? (
						<>
							{/* Header */}
							<div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-800">
								<Input
									value={selectedWorkflow.name}
									onChange={(e) => updateWorkflow({ ...selectedWorkflow, name: e.target.value })}
									disabled={selectedWorkflow.isDefault}
									inputClassName="font-semibold text-sm"
									className="max-w-xs"
								/>
								{selectedWorkflow.forStory && (
									<span className="flex items-center gap-1 text-[10px] text-purple-400 bg-purple-400/10 px-2 py-1 rounded font-medium shrink-0">
										<Layers size={10} /> story
									</span>
								)}
								{selectedWorkflow.isDefault && (
									<span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-1 rounded shrink-0">default</span>
								)}
								<div className="ml-auto flex items-center gap-1">
									<button
										onClick={() => handleExport(selectedWorkflow)}
										className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-gray-800 transition-colors"
										title="Export workflow as JSON"
									>
										<Download size={14} />
									</button>
									{!selectedWorkflow.isDefault && (
										<button
											onClick={() => handleDeleteWorkflow(selectedWorkflow.id)}
											className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-gray-800 transition-colors"
											title="Delete workflow"
										>
											<Trash2 size={14} />
										</button>
									)}
								</div>
							</div>

							{/* Slot editor */}
							<div className="flex-1 overflow-y-auto p-6">
								<WorkflowEditor
									workflow={selectedWorkflow}
									defaultBinary={defaultBinary}
									onUpdate={updateWorkflow}
									onEditSlot={(slot) => setEditingSlot({ wfId: selectedWorkflow.id, slot })}
									onAddCustom={() => setAddingCustomTo(selectedWorkflow.id)}
									onAddOrch={() => setAddingOrchTo(selectedWorkflow.id)}
								/>
							</div>

							{/* Footer */}
							<div className="shrink-0 border-t border-gray-800 px-6 py-3 flex justify-end">
								<Button size="sm" onClick={onSave} disabled={saving}>
									{saving ? "Saving..." : "Save"}
								</Button>
							</div>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-sm text-gray-600">
							Select a workflow to edit
						</div>
					)}
				</div>
			</div>

			{editingSlot && (
				<AgentSlotDialog slot={editingSlot.slot} onSave={handleSaveSlot} onClose={() => setEditingSlot(null)} />
			)}

			{addingCustomTo !== null && (
				<AddCustomAgentDialog
					defaultBinary={defaultBinary}
					onAdd={(name, binary, model, effort, prompt) => {
						const id = `slot_custom_${Date.now()}`;
						const wf = workflows.find((w) => w.id === addingCustomTo);
						if (!wf) return;
						const maxOrder = wf.slots.reduce((m, s) => Math.max(m, s.order), 0);
						const newSlot: WorkflowSlot = {
							id,
							type: "custom",
							name,
							agentBinary: binary,
							model,
							effort,
							order: maxOrder + 1,
							enabled: true,
							prompt,
						};
						updateWorkflow({ ...wf, slots: [...wf.slots, newSlot] });
						setAddingCustomTo(null);
					}}
					onClose={() => setAddingCustomTo(null)}
				/>
			)}

			{addingOrchTo !== null && (
				<AddCustomAgentDialog
					defaultBinary={defaultBinary}
					title="Add Orch Agent"
					onAdd={(name, binary, model, effort, prompt) => {
						const id = `slot_orch_${Date.now()}`;
						const wf = workflows.find((w) => w.id === addingOrchTo);
						if (!wf) return;
						const maxOrder = wf.slots.reduce((m, s) => Math.max(m, s.order), 0);
						const newSlot: WorkflowSlot = {
							id,
							type: "orch",
							name,
							agentBinary: binary,
							model,
							effort,
							order: maxOrder + 1,
							enabled: true,
							prompt,
						};
						updateWorkflow({ ...wf, slots: [...wf.slots, newSlot] });
						setAddingOrchTo(null);
					}}
					onClose={() => setAddingOrchTo(null)}
				/>
			)}
		</div>
	);
}

function WorkflowEditor({
	workflow,
	defaultBinary,
	onUpdate,
	onEditSlot,
	onAddCustom,
	onAddOrch,
}: {
	workflow: Workflow;
	defaultBinary: "claude" | "codex";
	onUpdate: (wf: Workflow) => void;
	onEditSlot: (slot: WorkflowSlot) => void;
	onAddCustom: () => void;
	onAddOrch: () => void;
}) {
	const devSlot = workflow.slots.find((s) => s.type === "dev");
	const nonDevSlots = workflow.slots.filter((s) => s.type !== "dev").sort((a, b) => a.order - b.order);
	const hasCR = workflow.slots.some((s) => s.type === "code_review");
	const hasQA = workflow.slots.some((s) => s.type === "qa");

	const handleDragEnd = (result: DropResult) => {
		if (!result.destination || result.destination.index === result.source.index) return;
		const reordered = [...nonDevSlots];
		const [moved] = reordered.splice(result.source.index, 1);
		if (!moved) return;
		reordered.splice(result.destination.index, 0, moved);
		const devSlots = workflow.slots.filter((s) => s.type === "dev");
		onUpdate({ ...workflow, slots: [...devSlots, ...reordered.map((s, i) => ({ ...s, order: i + 1 }))] });
	};

	const handleToggle = (slotId: string, enabled: boolean) => {
		onUpdate({ ...workflow, slots: workflow.slots.map((s) => (s.id === slotId ? { ...s, enabled } : s)) });
	};

	const handleRemove = (slotId: string) => {
		const remaining = workflow.slots.filter((s) => s.id !== slotId);
		const devs = remaining.filter((s) => s.type === "dev");
		const others = remaining.filter((s) => s.type !== "dev").map((s, i) => ({ ...s, order: i + 1 }));
		onUpdate({ ...workflow, slots: [...devs, ...others] });
	};

	const addBuiltinSlot = (type: "code_review" | "qa") => {
		const maxOrder = workflow.slots.reduce((m, s) => Math.max(m, s.order), 0);
		const defaults = {
			code_review: { id: "code_review", name: "Code Review", enabled: true },
			qa: { id: "qa", name: "QA", enabled: false },
		};
		const d = defaults[type];
		const newSlot: WorkflowSlot = { ...d, type, agentBinary: defaultBinary, order: maxOrder + 1, prompt: "" };
		onUpdate({ ...workflow, slots: [...workflow.slots, newSlot] });
	};

	// Story workflows: orch-only editor
	if (workflow.forStory) {
		const orchSlots = workflow.slots.filter((s) => s.type === "orch").sort((a, b) => a.order - b.order);
		const handleOrchDragEnd = (result: DropResult) => {
			if (!result.destination || result.destination.index === result.source.index) return;
			const reordered = [...orchSlots];
			const [moved] = reordered.splice(result.source.index, 1);
			if (!moved) return;
			reordered.splice(result.destination.index, 0, moved);
			onUpdate({ ...workflow, slots: reordered.map((s, i) => ({ ...s, order: i })) });
		};
		return (
			<div className="border border-purple-900/50 rounded-xl p-4 space-y-3">
				<DragDropContext onDragEnd={handleOrchDragEnd}>
					<Droppable droppableId={`wf-story-${workflow.id}`}>
						{(provided) => (
							<div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
								{orchSlots.map((slot, idx) => (
									<Draggable key={slot.id} draggableId={`${workflow.id}-${slot.id}`} index={idx}>
										{(drag, snapshot) => (
											<div
												ref={drag.innerRef}
												{...drag.draggableProps}
												className={`rounded-xl border transition-shadow ${snapshot.isDragging ? "border-purple-600 shadow-lg" : "border-purple-900/40"}`}
											>
												<SlotCard
													slot={slot}
													dragHandleProps={drag.dragHandleProps ?? undefined}
													onToggle={(v) => handleToggle(slot.id, v)}
													onRemove={() => handleRemove(slot.id)}
													onEdit={() => onEditSlot(slot)}
												/>
											</div>
										)}
									</Draggable>
								))}
								{provided.placeholder}
							</div>
						)}
					</Droppable>
				</DragDropContext>
				<div className="pt-1 border-t border-purple-900/30">
					<button
						onClick={onAddOrch}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-400 transition-colors py-1"
					>
						<Plus size={11} /> Orch Agent
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="border border-gray-800 rounded-xl p-4 space-y-3">
			{/* Dev slot — always first, fixed position */}
			{devSlot && <SlotCard slot={devSlot} isFixed onEdit={() => onEditSlot(devSlot)} />}

			{/* Non-dev slots — draggable */}
			<DragDropContext onDragEnd={handleDragEnd}>
				<Droppable droppableId={`wf-${workflow.id}`}>
					{(provided) => (
						<div className="space-y-2" ref={provided.innerRef} {...provided.droppableProps}>
							{nonDevSlots.map((slot, idx) => (
								<Draggable key={slot.id} draggableId={`${workflow.id}-${slot.id}`} index={idx}>
									{(drag, snapshot) => (
										<div
											ref={drag.innerRef}
											{...drag.draggableProps}
											className={`rounded-xl border transition-shadow ${snapshot.isDragging ? "border-gray-600 shadow-lg" : "border-gray-700"}`}
										>
											<SlotCard
												slot={slot}
												dragHandleProps={drag.dragHandleProps ?? undefined}
												onToggle={(v) => handleToggle(slot.id, v)}
												onRemove={slot.type === "custom" ? () => handleRemove(slot.id) : undefined}
												onEdit={() => onEditSlot(slot)}
											/>
										</div>
									)}
								</Draggable>
							))}
							{provided.placeholder}
						</div>
					)}
				</Droppable>
			</DragDropContext>

			{/* Add agent buttons */}
			<div className="flex gap-2 flex-wrap pt-1 border-t border-gray-800">
				{!hasCR && (
					<button
						onClick={() => addBuiltinSlot("code_review")}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
					>
						<Plus size={11} /> Code Review
					</button>
				)}
				{!hasQA && (
					<button
						onClick={() => addBuiltinSlot("qa")}
						className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
					>
						<Plus size={11} /> QA
					</button>
				)}
				<button
					onClick={onAddCustom}
					className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition-colors py-1"
				>
					<Plus size={11} /> Custom Agent
				</button>
			</div>
		</div>
	);
}

function SlotCard({
	slot,
	isFixed,
	dragHandleProps,
	onToggle,
	onRemove,
	onEdit,
}: {
	slot: WorkflowSlot;
	isFixed?: boolean;
	dragHandleProps?: DraggableProvidedDragHandleProps;
	onToggle?: (v: boolean) => void;
	onRemove?: () => void;
	onEdit: () => void;
}) {
	return (
		<div className="bg-gray-900 rounded-xl px-3 py-2.5 flex gap-2">
			<div className="flex items-start pt-0.5 shrink-0">
				{dragHandleProps ? (
					<span
						{...(dragHandleProps as React.HTMLAttributes<HTMLSpanElement>)}
						className="text-gray-600 hover:text-gray-400 cursor-grab active:cursor-grabbing"
					>
						<GripVertical size={13} />
					</span>
				) : (
					<span className="w-[13px]" />
				)}
			</div>
			<div className="flex-1 min-w-0 space-y-1">
				{/* Row 1: name + actions */}
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-1.5 min-w-0">
						<span className="text-sm text-gray-200 truncate">{slot.name}</span>
						{slot.type !== "custom" && (
							<span className="text-xs text-gray-600 shrink-0">{slot.type.replace("_", " ")}</span>
						)}
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{!isFixed && onToggle && <Switch checked={slot.enabled} onChange={onToggle} size="sm" />}
						<button onClick={onEdit} className="text-gray-500 hover:text-gray-200 transition-colors">
							<Settings2 size={13} />
						</button>
					</div>
				</div>
				{/* Row 2: badges + delete */}
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded font-mono">
						{slot.agentBinary}
					</span>
					{slot.model && (
						<span className="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
							{slot.model}
						</span>
					)}
					{slot.effort && (
						<span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono">
							{slot.effort}
						</span>
					)}
					{slot.prompt && (
						<span className="text-[10px] text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">custom prompt</span>
					)}
					{onRemove && (
						<button onClick={onRemove} className="ml-auto text-gray-600 hover:text-red-400 transition-colors">
							<Trash2 size={13} />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

// Dropdown of curated per-agent model presets with an optional custom override.
// Empty string = use the agent's default model.
// For opencode, the list is fetched by running `opencode models` on demand.
function ModelSelect({
	agentId,
	value,
	onChange,
}: {
	agentId: RuntimeAgentId;
	value: string;
	onChange: (v: string) => void;
}) {
	const staticOptions = MODEL_OPTIONS[agentId];

	const [dynamicModels, setDynamicModels] = useState<string[]>([]);
	const [isFetching, setIsFetching] = useState(false);

	const fetchOpencodeModels = () => {
		setIsFetching(true);
		trpc.agents.opencodeModels
			.query()
			.then((models) => setDynamicModels(models))
			.catch(() => {})
			.finally(() => setIsFetching(false));
	};

	useEffect(() => {
		if (agentId === "opencode") fetchOpencodeModels();
	}, [agentId]);

	const options =
		agentId === "opencode"
			? dynamicModels.map((m) => ({ value: m, label: m }))
			: staticOptions;

	const isPresetValue = value === "" || options.some((o) => o.value === value);
	const [customMode, setCustomMode] = useState(!isPresetValue);

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<div className="flex-1">
					<Select
						value={customMode ? "__custom__" : value}
						onChange={(v) => {
							if (v === "__custom__") {
								setCustomMode(true);
							} else {
								setCustomMode(false);
								onChange(v);
							}
						}}
						filterable
					>
						<SelectOption value="" label="Default" />
						{options.map((o) => (
							<SelectOption key={o.value} value={o.value} label={o.label} />
						))}
						<SelectOption value="__custom__" label="Custom..." />
					</Select>
				</div>
				{agentId === "opencode" && (
					<button
						type="button"
						onClick={fetchOpencodeModels}
						disabled={isFetching}
						title="Refresh model list"
						className="flex items-center justify-center px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
					>
						<svg
							className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</button>
				)}
			</div>
			{customMode && (
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={
						agentId === "opencode"
							? "e.g. anthropic/claude-opus-4-7"
							: agentId === "claude"
								? "e.g. claude-opus-4-7"
								: "e.g. gpt-5-codex"
					}
				/>
			)}
		</div>
	);
}

function AgentSlotDialog({
	slot,
	onSave,
	onClose,
}: {
	slot: WorkflowSlot;
	onSave: (updated: WorkflowSlot) => void;
	onClose: () => void;
}) {
	const [binary, setBinary] = useState<RuntimeAgentId>(slot.agentBinary);
	const [model, setModel] = useState<string>(slot.model ?? "");
	const [effort, setEffort] = useState<EffortLevel | "">(slot.effort ?? "");
	const [prompt, setPrompt] = useState(slot.prompt ?? "");
	const [promptError, setPromptError] = useState("");

	const handleSave = () => {
		if ((slot.type === "custom" || slot.type === "orch") && prompt.trim().length > 0 && prompt.trim().length < 50) {
			setPromptError("Prompt must be at least 50 characters.");
			return;
		}
		setPromptError("");
		onSave({ ...slot, agentBinary: binary, model: model || null, effort: effort || null, prompt });
	};

	const placeholder: Record<string, string> = {
		dev: "e.g. Always use TypeScript strict mode. Follow existing naming conventions.",
		code_review: "e.g. Check all new API routes have auth middleware.",
		qa: "e.g. Always run the full test suite with pnpm test.",
		orch: "e.g. Review all subtask implementations together. Check that they integrate correctly and fulfill the story goal.",
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-sm font-semibold text-gray-100">Edit — {slot.name}</h3>

				<div className="grid grid-cols-2 gap-3">
					<Field label="Agent">
						<Select
							value={binary}
							onChange={(v) => {
								setBinary(v as RuntimeAgentId);
								setModel("");
							}}
						>
							{AGENT_BINARY_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
					<Field label="Effort (optional)">
						<Select value={effort} onChange={(v) => setEffort(v as EffortLevel | "")}>
							<SelectOption value="" label="Default" />
							{EFFORT_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
				</div>

				<Field label="Model (optional)">
					<ModelSelect key={binary} agentId={binary} value={model} onChange={setModel} />
				</Field>

				<Field
					label={`Instructions${slot.type === "custom" || slot.type === "orch" ? " (min 50 chars)" : " (optional)"}`}
				>
					<Textarea
						value={prompt}
						onChange={(e) => {
							setPrompt(e.target.value);
							if (promptError) setPromptError("");
						}}
						placeholder={placeholder[slot.type] ?? "Describe what this agent should check or do..."}
						rows={6}
						className="max-h-64 overflow-y-auto resize-y"
					/>
					{promptError && <p className="text-xs text-red-400 mt-1">{promptError}</p>}
				</Field>

				<div className="flex gap-2 justify-end">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleSave}>Save</Button>
				</div>
			</div>
		</div>
	);
}

function AddCustomAgentDialog({
	defaultBinary,
	title = "Add Custom Agent",
	onAdd,
	onClose,
}: {
	defaultBinary: "claude" | "codex";
	title?: string;
	onAdd: (
		name: string,
		binary: "claude" | "codex",
		model: string | null,
		effort: EffortLevel | null,
		prompt: string,
	) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [binary, setBinary] = useState<"claude" | "codex">(defaultBinary);
	const [model, setModel] = useState<string>("");
	const [effort, setEffort] = useState<EffortLevel | "">("");
	const [prompt, setPrompt] = useState("");
	const [promptError, setPromptError] = useState("");

	const handleAdd = () => {
		if (!name.trim()) return;
		if (prompt.trim().length < 50) {
			setPromptError("Instructions must be at least 50 characters.");
			return;
		}
		onAdd(name.trim(), binary, model || null, effort || null, prompt);
	};

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-5 space-y-4"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="text-sm font-semibold text-gray-100">{title}</h3>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Name">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Security Review"
							autoFocus
						/>
					</Field>
					<Field label="Agent">
						<Select
							value={binary}
							onChange={(v) => {
								setBinary(v as RuntimeAgentId);
								setModel("");
							}}
						>
							{AGENT_BINARY_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
				</div>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Model (optional)">
						<ModelSelect key={binary} agentId={binary} value={model} onChange={setModel} />
					</Field>
					<Field label="Effort (optional)">
						<Select value={effort} onChange={(v) => setEffort(v as EffortLevel | "")}>
							<SelectOption value="" label="Default" />
							{EFFORT_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</Select>
					</Field>
				</div>
				<Field label="Instructions (min 50 chars)">
					<Textarea
						value={prompt}
						onChange={(e) => {
							setPrompt(e.target.value);
							if (promptError) setPromptError("");
						}}
						placeholder="Describe what this agent should check or do..."
						maxRows={20}
						autoResize
					/>
					{promptError && <p className="text-xs text-red-400 mt-1">{promptError}</p>}
				</Field>
				<div className="flex gap-2 justify-end">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleAdd} disabled={!name.trim()}>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}

// ─── Environment Section ─────────────────────────────────────────────────────

function EnvironmentSection({
	workspaceId,
	setup,
	onChange,
	startCommand,
	onStartCommandChange,
	onSave,
	saving,
}: {
	workspaceId: string;
	setup: RuntimeWorktreeSetup;
	onChange: (setup: RuntimeWorktreeSetup) => void;
	startCommand: string;
	onStartCommandChange: (cmd: string) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const [rootFiles, setRootFiles] = useState<string[] | null>(null);
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [manualInput, setManualInput] = useState("");

	const fetchFiles = async () => {
		setLoadingFiles(true);
		try {
			const { files } = await trpc.workspace.listRootFiles.query({ workspaceId });
			setRootFiles(files);
		} catch {
			toast.error("Failed to list repo files");
		} finally {
			setLoadingFiles(false);
		}
	};

	useEffect(() => {
		fetchFiles();
	}, [workspaceId]);

	const toggleFile = (file: string, checked: boolean) => {
		const next = checked ? [...new Set([...setup.filesToCopy, file])] : setup.filesToCopy.filter((f) => f !== file);
		onChange({ ...setup, filesToCopy: next });
	};

	const addManual = () => {
		const val = manualInput.trim();
		if (!val) return;
		onChange({ ...setup, filesToCopy: [...new Set([...setup.filesToCopy, val])] });
		setManualInput("");
	};

	const removeFile = (file: string) => {
		onChange({ ...setup, filesToCopy: setup.filesToCopy.filter((f) => f !== file) });
	};

	// Files to show in the picker: union of discovered root files + manually added ones
	const discoveredSet = new Set(rootFiles ?? []);
	const allFiles = [...new Set([...(rootFiles ?? []), ...setup.filesToCopy])].sort();
	const manualOnly = setup.filesToCopy.filter((f) => !discoveredSet.has(f));

	return (
		<>
			<SectionHeader
				title="Environment"
				description="Configure how each new worktree is set up before the agent starts. Runs once per task on first creation."
			/>

			{/* Files to copy */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className="text-xs font-medium text-gray-300">Files to Copy</p>
					<button
						onClick={fetchFiles}
						disabled={loadingFiles}
						className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
					>
						<RefreshCw size={11} className={loadingFiles ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
				<p className="text-xs text-gray-500">
					Gitignored files found in the repo root. Selected files are copied into each new worktree before the agent
					runs.
				</p>

				<div className="border border-gray-800 rounded-xl overflow-hidden">
					{loadingFiles && <div className="px-4 py-6 text-center text-xs text-gray-500">Scanning repo...</div>}

					{!loadingFiles && allFiles.length === 0 && (
						<div className="px-4 py-6 text-center text-xs text-gray-500">No gitignored files found in repo root</div>
					)}

					{!loadingFiles &&
						allFiles.map((file) => {
							const isChecked = setup.filesToCopy.includes(file);
							const isManual = manualOnly.includes(file);
							return (
								<label
									key={file}
									className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800 last:border-0 transition-colors"
								>
									<Checkbox checked={isChecked} onChange={(e) => toggleFile(file, e.target.checked)} />
									<span className="flex-1 text-xs font-mono text-gray-200">{file}</span>
									{isManual && (
										<span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">manual</span>
									)}
									{isManual && (
										<button
											onClick={(e) => {
												e.preventDefault();
												removeFile(file);
											}}
											className="text-gray-600 hover:text-red-400 transition-colors"
										>
											<X size={11} />
										</button>
									)}
								</label>
							);
						})}
				</div>

				{/* Manual path input */}
				<div className="flex gap-2">
					<Input
						value={manualInput}
						onChange={(e) => setManualInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addManual()}
						placeholder="Add path manually (e.g. .env.local)"
						inputClassName="font-mono text-xs"
					/>
					<Button variant="outlined" size="sm" onClick={addManual} disabled={!manualInput.trim()}>
						<Plus size={12} className="mr-1" />
						Add
					</Button>
				</div>
			</div>

			{/* Install command */}
			<Field label="Install Command">
				<Input
					value={setup.installCommand}
					onChange={(e) => onChange({ ...setup, installCommand: e.target.value })}
					placeholder="pnpm install --frozen-lockfile"
					inputClassName="font-mono text-xs"
				/>
				<p className="text-xs text-gray-500 mt-1">
					Runs in the worktree directory. Use{" "}
					<code className="text-gray-400 bg-gray-800 px-1 py-0.5 rounded">$REPO_PATH</code> to reference the main repo.
				</p>
			</Field>

			{/* Start command */}
			<Field label="Start Command">
				<Input
					value={startCommand}
					onChange={(e) => onStartCommandChange(e.target.value)}
					placeholder="pnpm dev"
					inputClassName="font-mono text-xs"
				/>
				<p className="text-xs text-gray-500 mt-1">
					Command to run when you press ▶ on a ticket. Runs in the ticket's worktree (or repo root if no worktree exists
					yet).
				</p>
			</Field>

			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}

// ─── Secrets Section ─────────────────────────────────────────────────────────

function parseEnvText(text: string): RuntimeProjectSecret[] {
	return text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"))
		.flatMap((l) => {
			const noExport = l.replace(/^export\s+/, "");
			const eq = noExport.indexOf("=");
			if (eq === -1) return [];
			const key = noExport.slice(0, eq).trim();
			let value = noExport.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			return key ? [{ key, value }] : [];
		});
}

function SecretsSection({
	secrets,
	onChange,
	onSave,
	saving,
}: {
	secrets: RuntimeProjectSecret[];
	onChange: (secrets: RuntimeProjectSecret[]) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const [revealed, setRevealed] = useState<Set<string>>(new Set());
	const [envText, setEnvText] = useState("");

	const allSecrets: RuntimeProjectSecret[] = [
		...BUILTIN_SECRET_KEYS.map((key) => secrets.find((s) => s.key === key) ?? { key, value: "" }),
		...secrets.filter((s) => !(BUILTIN_SECRET_KEYS as readonly string[]).includes(s.key)),
	];

	const updateSecret = (key: string, value: string) => {
		onChange(allSecrets.map((s) => (s.key === key ? { ...s, value } : s)));
	};

	const removeSecret = (key: string) => {
		onChange(allSecrets.filter((s) => s.key !== key));
	};

	const toggleReveal = (key: string) => {
		setRevealed((prev) => {
			const next = new Set(prev);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	};

	const applyEnvText = () => {
		const parsed = parseEnvText(envText);
		if (parsed.length === 0) return;
		const merged = [...allSecrets];
		for (const { key, value } of parsed) {
			const idx = merged.findIndex((s) => s.key === key);
			if (idx !== -1) merged[idx] = { key, value };
			else merged.push({ key, value });
		}
		onChange(merged);
		setEnvText("");
	};

	return (
		<>
			<SectionHeader
				title="Secrets"
				description="Tokens injected into every agent's system prompt. Stored locally only."
			/>

			{/* Secret rows */}
			<div className="border border-gray-800 rounded-xl overflow-hidden">
				{allSecrets.map((secret, i) => {
					const isBuiltin = (BUILTIN_SECRET_KEYS as readonly string[]).includes(secret.key);
					const isRevealed = revealed.has(secret.key);
					return (
						<div
							key={secret.key}
							className={`flex items-center gap-2 px-3 py-2 ${i < allSecrets.length - 1 ? "border-b border-gray-800" : ""}`}
						>
							<div className="flex items-center gap-1.5 w-40 shrink-0">
								<span className="text-xs font-mono text-gray-200 truncate">{secret.key}</span>
								{isBuiltin && (
									<span className="text-[9px] text-blue-400 border border-blue-500/30 px-1 py-px rounded shrink-0">
										default
									</span>
								)}
							</div>
							<div className="relative flex-1">
								<input
									type={isRevealed ? "text" : "password"}
									value={secret.value}
									onChange={(e) => updateSecret(secret.key, e.target.value)}
									placeholder="not set"
									className="w-full bg-transparent text-xs font-mono text-gray-300 placeholder-gray-600 focus:outline-none pr-6"
								/>
								<button
									type="button"
									onClick={() => toggleReveal(secret.key)}
									className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 transition-colors"
								>
									{isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
								</button>
							</div>
							{!isBuiltin ? (
								<button
									onClick={() => removeSecret(secret.key)}
									className="text-gray-700 hover:text-red-400 transition-colors shrink-0"
								>
									<X size={12} />
								</button>
							) : (
								<div className="w-3 shrink-0" />
							)}
						</div>
					);
				})}
			</div>

			<SaveRow saving={saving} onSave={onSave} />

			{/* Paste .env */}
			<div className="border-t border-gray-800 pt-4 space-y-2">
				<p className="text-xs text-gray-400">
					Paste <code className="text-gray-500">.env</code> — add or overwrite multiple secrets at once
				</p>
				<Textarea
					value={envText}
					onChange={(e) => setEnvText(e.target.value)}
					placeholder={'GITHUB_TOKEN=ghp_xxx\nFIGMA_TOKEN="abc123"\n# comments ignored'}
					rows={4}
					className="w-full bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600 resize-none"
				/>
				<div className="flex justify-end">
					<Button variant="outlined" size="sm" onClick={applyEnvText} disabled={!envText.trim()}>
						<Plus size={12} className="mr-1" />
						Apply
					</Button>
				</div>
			</div>
		</>
	);
}

// ─── Global Settings ────────────────────────────────────────────────────────

function GlobalSettings({ section }: { section: GlobalSection }) {
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

// ─── Shared helpers ──────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
	return (
		<div>
			<h2 className="text-base font-semibold text-gray-100">{title}</h2>
			<p className="text-sm text-gray-500 mt-1">{description}</p>
		</div>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<label className="text-xs text-gray-400 block mb-1">{label}</label>
			{children}
		</div>
	);
}

function SaveRow({ saving, onSave }: { saving: boolean; onSave: () => void }) {
	return (
		<div className="flex justify-end pt-2">
			<Button onClick={onSave} disabled={saving}>
				{saving ? "Saving..." : "Save"}
			</Button>
		</div>
	);
}
