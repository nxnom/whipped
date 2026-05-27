import { Button, Checkbox, Input, toast } from "@geckoui/geckoui";
import type { RuntimeJiraTicket, RuntimeProjectConfig } from "@runtime-contract";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { classNames } from "@/utils/classNames";
import { trpc } from "@/runtime/trpc-client";
import { Field, SaveRow, SectionHeader } from "../_shared";

export function JiraSection({
	workspaceId,
	config,
	saving,
	onUpdate,
	onSave,
}: {
	workspaceId: string;
	config: RuntimeProjectConfig;
	saving: boolean;
	onUpdate: (next: RuntimeProjectConfig) => void;
	onSave: () => void;
}) {
	const [jiraTickets, setJiraTickets] = useState<RuntimeJiraTicket[] | null>(null);
	const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set());
	const [fetchingJira, setFetchingJira] = useState(false);
	const [importing, setImporting] = useState(false);

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

	return (
		<>
			<SectionHeader title="Jira" description="Connect your Jira project to import tickets directly onto the board." />
			<div className="space-y-4">
				<Field label="Host">
					<Input
						value={config.jira?.host ?? ""}
						onChange={(e) => onUpdate({ ...config, jira: { ...config.jira!, host: e.target.value } })}
						placeholder="company.atlassian.net"
					/>
				</Field>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Email">
						<Input
							value={config.jira?.email ?? ""}
							onChange={(e) => onUpdate({ ...config, jira: { ...config.jira!, email: e.target.value } })}
							placeholder="you@company.com"
						/>
					</Field>
					<Field label="API Token">
						<Input
							type="password"
							value={config.jira?.token ?? ""}
							onChange={(e) => onUpdate({ ...config, jira: { ...config.jira!, token: e.target.value } })}
							placeholder="••••••••"
						/>
					</Field>
				</div>
				<Field label="Project Key">
					<Input
						value={config.jira?.projectKey ?? ""}
						onChange={(e) => onUpdate({ ...config, jira: { ...config.jira!, projectKey: e.target.value } })}
						placeholder="ENG"
					/>
				</Field>
			</div>
			<SaveRow saving={saving} onSave={onSave} />

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
							<RefreshCw size={12} className={classNames("mr-1.5", fetchingJira ? "animate-spin" : "")} />
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
	);
}
