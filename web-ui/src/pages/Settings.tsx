import { Button, Checkbox, Input, Select, SelectOption, Switch, Textarea, toast } from "@geckoui/geckoui";
import type { RuntimeGlobalConfig, RuntimeJiraTicket, RuntimeProjectConfig } from "@runtime-contract";
import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	workspaceId: string;
}

export function SettingsPage({ workspaceId }: Props) {
	const [activeTab, setActiveTab] = useState<"global" | "project">("project");

	return (
		<div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto space-y-4">
			{/* Tab switcher */}
			<div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1">
				{(["project", "global"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
							activeTab === tab ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
						}`}
					>
						{tab === "project" ? "Project Settings" : "Global Settings"}
					</button>
				))}
			</div>

			{activeTab === "project" ? <ProjectSettings workspaceId={workspaceId} /> : <GlobalSettings />}
		</div>
	);
}

// ─── Project Settings ───────────────────────────────────────────────────────

function ProjectSettings({ workspaceId }: { workspaceId: string }) {
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
		return <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading...</div>;
	}

	return (
		<div className="space-y-4">
			{/* Autonomous Mode */}
			<div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold text-gray-100">Autonomous Mode</h3>
					<p className="text-xs text-gray-400 mt-0.5">
						Agents automatically pick up <span className="text-emerald-400">Ready for Dev</span> and{" "}
						<span className="text-orange-400">Reopened</span> tasks
					</p>
				</div>
				<Switch
					checked={config.autonomousModeEnabled}
					onChange={handleToggleAutonomous}
					disabled={togglingAutonomous}
				/>
			</div>

			{/* Agent Instructions */}
			<Section title="Agent Instructions">
				<p className="text-xs text-gray-500 -mt-1">
					Extra instructions appended to each agent's system prompt. Use this for project-specific rules, conventions, or context.
				</p>
				<Field label="Dev Agent">
					<Textarea
						value={config.devPrompt ?? ""}
						onChange={(e) => setConfig({ ...config, devPrompt: e.target.value })}
						placeholder="e.g. Always use TypeScript strict mode. Follow the existing naming conventions in the codebase."
						rows={3}
						autoResize
					/>
				</Field>
				<Field label="Code Review Agent">
					<Textarea
						value={config.codeReviewPrompt ?? ""}
						onChange={(e) => setConfig({ ...config, codeReviewPrompt: e.target.value })}
						placeholder="e.g. Check that all new API routes have auth middleware. Reject any use of console.log."
						rows={3}
						autoResize
					/>
				</Field>
				<Field label="QA Agent">
					<Textarea
						value={config.qaPrompt ?? ""}
						onChange={(e) => setConfig({ ...config, qaPrompt: e.target.value })}
						placeholder="e.g. Always run the full test suite with pnpm test. Check mobile viewports in Playwright."
						rows={3}
						autoResize
					/>
				</Field>
			</Section>

			{/* GitHub */}
			<Section title="GitHub">
				<Field label="Personal Access Token">
					<Input
						type="password"
						value={config.github?.token ?? ""}
						onChange={(e) => setConfig({ ...config, github: { token: e.target.value } })}
						placeholder="ghp_..."
					/>
				</Field>
				<p className="text-xs text-gray-500">
					Required for posting PR comments. Needs <code className="text-gray-400">repo</code> scope.
				</p>
			</Section>

			{/* Jira */}
			<Section title="Jira">
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

				{/* Jira import */}
				<div className="pt-3 border-t border-gray-800 space-y-3">
					<div className="flex items-center justify-between">
						<p className="text-xs font-medium text-gray-300">Import Tickets</p>
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
							<div className="max-h-64 overflow-y-auto space-y-1.5">
								{jiraTickets.map((ticket) => (
									<label
										key={ticket.key}
										className="flex items-start gap-2.5 bg-gray-800 hover:bg-gray-750 rounded-lg p-2.5 cursor-pointer"
									>
										<Checkbox
											checked={selectedTickets.has(ticket.key)}
											onChange={(e) => {
												const next = new Set(selectedTickets);
												if (e.target.checked) {
													next.add(ticket.key);
												} else {
													next.delete(ticket.key);
												}
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
			</Section>

			<div className="flex justify-end pb-4">
				<Button onClick={handleSave} disabled={saving}>
					{saving ? "Saving..." : "Save Project Settings"}
				</Button>
			</div>
		</div>
	);
}

// ─── Global Settings ────────────────────────────────────────────────────────

function GlobalSettings() {
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
		return <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading...</div>;
	}

	return (
		<div className="space-y-4">
			{/* General */}
			<Section title="General">
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
					<Field label="Polling Interval (seconds)">
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
			</Section>

			{/* AI Review */}
			<Section title="AI Review">
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
							onChange={(v) => setConfig({ ...config, review: { ...config.review, qaAgent: v as "claude" | "codex" } })}
							placeholder="Select agent"
						>
							<SelectOption value="claude" label="Claude Code" />
							<SelectOption value="codex" label="OpenAI Codex" />
						</Select>
					</Field>
				</div>
			</Section>

			<div className="flex justify-end pb-4">
				<Button onClick={handleSave} disabled={saving}>
					{saving ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
			<h3 className="text-sm font-semibold text-gray-200">{title}</h3>
			{children}
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
