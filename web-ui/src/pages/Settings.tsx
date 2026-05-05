import { Button, Checkbox, Input, Select, SelectOption, Switch, Textarea, toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig, RuntimeJiraTicket, RuntimeProjectConfig, RuntimeWorktreeSetup } from "@runtime-contract";
import { Bot, Download, MessageSquare, Plus, RefreshCw, Settings2, Terminal, Ticket, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

type ProjectSection = "autonomous" | "prompts" | "environment" | "jira";
type GlobalSection = "general" | "ai-review";
type SettingsSection = ProjectSection | GlobalSection;

const PROJECT_NAV: Array<{ id: ProjectSection; label: string; icon: React.ReactNode }> = [
	{ id: "autonomous", label: "Autonomous", icon: <Zap size={14} /> },
	{ id: "prompts", label: "Agent Prompts", icon: <MessageSquare size={14} /> },
	{ id: "environment", label: "Environment", icon: <Terminal size={14} /> },
	{ id: "jira", label: "Jira", icon: <Ticket size={14} /> },
];

const GLOBAL_NAV: Array<{ id: GlobalSection; label: string; icon: React.ReactNode }> = [
	{ id: "general", label: "General", icon: <Settings2 size={14} /> },
	{ id: "ai-review", label: "AI Review", icon: <Bot size={14} /> },
];

const PROJECT_SECTIONS = new Set<SettingsSection>(["autonomous", "prompts", "environment", "jira"]);

interface Props {
	workspaceId: string;
}

export function SettingsPage({ workspaceId }: Props) {
	const [section, setSection] = useState<SettingsSection>("autonomous");
	const isProject = PROJECT_SECTIONS.has(section);

	return (
		<div className="flex-1 overflow-hidden flex">
			{/* Sidebar nav */}
			<nav className="w-44 shrink-0 border-r border-gray-800 py-4 overflow-y-auto">
				<NavGroup label="Project" items={PROJECT_NAV} activeId={section} onSelect={setSection} />
				<NavGroup label="Global" items={GLOBAL_NAV} activeId={section} onSelect={setSection} />
			</nav>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				{isProject ? (
					<ProjectSettings workspaceId={workspaceId} section={section as ProjectSection} />
				) : (
					<GlobalSettings section={section as GlobalSection} />
				)}
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
	const [saving, setSaving] = useState(false);
	const [togglingAutonomous, setTogglingAutonomous] = useState(false);
	const [jiraTickets, setJiraTickets] = useState<RuntimeJiraTicket[] | null>(null);
	const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
	const [fetchingJira, setFetchingJira] = useState(false);
	const [importing, setImporting] = useState(false);

	useEffect(() => {
		setConfig(null);
		trpc.projectConfig.get
			.query({ workspaceId })
			.then(setConfig)
			.catch(() => {});
	}, [workspaceId]);

	const handleToggleAutonomous = async () => {
		if (!config) return;
		const next = !config.autonomousModeEnabled;
		setTogglingAutonomous(true);
		try {
			await trpc.workspace.setAutonomousMode.mutate({ workspaceId, enabled: next });
			setConfig({ ...config, autonomousModeEnabled: next });
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

	return (
		<div className="p-6 max-w-xl space-y-6">
			{section === "autonomous" && (
				<>
					<SectionHeader
						title="Autonomous Mode"
						description="When enabled, agents automatically pick up tasks from Ready for Dev and Reopened columns without manual intervention."
					/>
					<div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl p-4">
						<div>
							<p className="text-sm font-medium text-gray-100">Enable autonomous mode</p>
							<p className="text-xs text-gray-500 mt-0.5">
								Picks up <span className="text-emerald-400">Ready for Dev</span> and{" "}
								<span className="text-orange-400">Reopened</span> tasks automatically
							</p>
						</div>
						<Switch
							checked={config.autonomousModeEnabled}
							onChange={handleToggleAutonomous}
							disabled={togglingAutonomous}
						/>
					</div>
				</>
			)}

			{section === "prompts" && (
				<>
					<SectionHeader
						title="Agent Prompts"
						description="Extra instructions appended to each agent's system prompt. Use this for project-specific rules, conventions, or context."
					/>
					<div className="space-y-4">
						<Field label="Dev Agent">
							<Textarea
								value={config.devPrompt ?? ""}
								onChange={(e) => setConfig({ ...config, devPrompt: e.target.value })}
								placeholder="e.g. Always use TypeScript strict mode. Follow the existing naming conventions."
								rows={4}
								autoResize
							/>
						</Field>
						<Field label="Code Review Agent">
							<Textarea
								value={config.codeReviewPrompt ?? ""}
								onChange={(e) => setConfig({ ...config, codeReviewPrompt: e.target.value })}
								placeholder="e.g. Check that all new API routes have auth middleware."
								rows={4}
								autoResize
							/>
						</Field>
						<Field label="QA Agent">
							<Textarea
								value={config.qaPrompt ?? ""}
								onChange={(e) => setConfig({ ...config, qaPrompt: e.target.value })}
								placeholder="e.g. Always run the full test suite with pnpm test."
								rows={4}
								autoResize
							/>
						</Field>
					</div>
					<SaveRow saving={saving} onSave={handleSave} />
				</>
			)}

			{section === "environment" && (
				<EnvironmentSection
					workspaceId={workspaceId}
					setup={config.worktreeSetup ?? { filesToCopy: [], installCommand: "" }}
					onChange={(worktreeSetup) => setConfig({ ...config, worktreeSetup })}
					onSave={handleSave}
					saving={saving}
				/>
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
								onChange={(e) => setConfig({ ...config, jira: { ...config.jira!, host: e.target.value } })}
								placeholder="company.atlassian.net"
							/>
						</Field>
						<div className="grid grid-cols-2 gap-3">
							<Field label="Email">
								<Input
									value={config.jira?.email ?? ""}
									onChange={(e) => setConfig({ ...config, jira: { ...config.jira!, email: e.target.value } })}
									placeholder="you@company.com"
								/>
							</Field>
							<Field label="API Token">
								<Input
									type="password"
									value={config.jira?.token ?? ""}
									onChange={(e) => setConfig({ ...config, jira: { ...config.jira!, token: e.target.value } })}
									placeholder="••••••••"
								/>
							</Field>
						</div>
						<Field label="Project Key">
							<Input
								value={config.jira?.projectKey ?? ""}
								onChange={(e) => setConfig({ ...config, jira: { ...config.jira!, projectKey: e.target.value } })}
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
	);
}

// ─── Environment Section ─────────────────────────────────────────────────────

function EnvironmentSection({
	workspaceId,
	setup,
	onChange,
	onSave,
	saving,
}: {
	workspaceId: string;
	setup: RuntimeWorktreeSetup;
	onChange: (setup: RuntimeWorktreeSetup) => void;
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
		const next = checked
			? [...new Set([...setup.filesToCopy, file])]
			: setup.filesToCopy.filter((f) => f !== file);
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
					Gitignored files found in the repo root. Selected files are copied into each new worktree before the agent runs.
				</p>

				<div className="border border-gray-800 rounded-xl overflow-hidden">
					{loadingFiles && (
						<div className="px-4 py-6 text-center text-xs text-gray-500">Scanning repo...</div>
					)}

					{!loadingFiles && allFiles.length === 0 && (
						<div className="px-4 py-6 text-center text-xs text-gray-500">
							No gitignored files found in repo root
						</div>
					)}

					{!loadingFiles && allFiles.map((file) => {
						const isChecked = setup.filesToCopy.includes(file);
						const isManual = manualOnly.includes(file);
						return (
							<label
								key={file}
								className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800 last:border-0 transition-colors"
							>
								<Checkbox
									checked={isChecked}
									onChange={(e) => toggleFile(file, e.target.checked)}
								/>
								<span className="flex-1 text-xs font-mono text-gray-200">{file}</span>
								{isManual && (
									<span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">manual</span>
								)}
								{isManual && (
									<button
										onClick={(e) => { e.preventDefault(); removeFile(file); }}
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
					Runs in the worktree directory. Use <code className="text-gray-400 bg-gray-800 px-1 py-0.5 rounded">$REPO_PATH</code> to reference the main repo.
				</p>
			</Field>

			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}

// ─── Global Settings ────────────────────────────────────────────────────────

function GlobalSettings({ section }: { section: GlobalSection }) {
	const [config, setConfig] = useState<RuntimeGlobalConfig | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		trpc.config.get
			.query()
			.then(setConfig)
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
					<SectionHeader
						title="General"
						description="Runtime behavior settings that apply to all projects."
					/>
					<div className="space-y-4">
						<Field label="Default Agent">
							<Select
								value={config.defaultAgent}
								onChange={(v) => setConfig({ ...config, defaultAgent: v as "claude" | "codex" })}
								placeholder="Select agent"
							>
								<SelectOption value="claude" label="Claude Code" />
								<SelectOption value="codex" label="OpenAI Codex" />
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
						</div>
					</div>
					<SaveRow saving={saving} onSave={handleSave} />
				</>
			)}

			{section === "ai-review" && (
				<>
					<SectionHeader
						title="AI Review"
						description="Choose which AI agents handle code review and QA tasks."
					/>
					<div className="space-y-4">
						<div className="grid grid-cols-2 gap-3">
							<Field label="Code Review Agent">
								<Select
									value={config.review.codeReviewAgent}
									onChange={(v) =>
										setConfig({ ...config, review: { ...config.review, codeReviewAgent: v as "claude" | "codex" } })
									}
									placeholder="Select agent"
								>
									<SelectOption value="claude" label="Claude Code" />
									<SelectOption value="codex" label="OpenAI Codex" />
								</Select>
							</Field>
							<Field label="QA Agent">
								<Select
									value={config.review.qaAgent}
									onChange={(v) =>
										setConfig({ ...config, review: { ...config.review, qaAgent: v as "claude" | "codex" } })
									}
									placeholder="Select agent"
								>
									<SelectOption value="claude" label="Claude Code" />
									<SelectOption value="codex" label="OpenAI Codex" />
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
