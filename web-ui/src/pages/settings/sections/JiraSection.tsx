import { Button, Checkbox, RHFInput, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeJiraTicket, RuntimeProjectConfig } from "@runtime-contract";
import { type JiraConfigValues, jiraConfigSchema } from "@runtime-validation/jira";
import { Download, RefreshCw } from "lucide-react";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { Field, SaveRow, SectionHeader } from "../_shared";

const EMPTY_JIRA: JiraConfigValues = { host: "", email: "", token: "", projectKey: "" };

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

	const methods = useForm<JiraConfigValues>({
		resolver: zodResolver(jiraConfigSchema),
		values: { ...EMPTY_JIRA, ...config.jira },
	});

	// Push edits back into the parent-owned project config so the existing
	// Save flow persists them. RHF `values` keeps the form in sync the other way.
	const updateJira = (patch: Partial<JiraConfigValues>) =>
		onUpdate({ ...config, jira: { ...EMPTY_JIRA, ...config.jira, ...patch } });

	const { trigger: fetchTicketsTrigger, loading: fetchingJira } = useRead(
		(api) => api("jira/tickets").GET({ query: { workspaceId } }),
		{ enabled: false },
	);
	const { trigger: importTrigger, loading: importing } = useWrite((api) => api("jira/import").POST());

	const handleFetchJira = async () => {
		setJiraTickets(null);
		const res = await fetchTicketsTrigger();
		if (res.error || !res.data) {
			toast.error("Failed to fetch Jira tickets. Check your Jira configuration.");
			return;
		}
		setJiraTickets(res.data);
	};

	const handleImport = async () => {
		if (selectedTickets.size === 0) return;
		const res = await importTrigger({ body: { workspaceId, ticketKeys: Array.from(selectedTickets) } });
		if (res.error || !res.data) {
			toast.error("Failed to import tickets");
			return;
		}
		toast.success(`Imported ${res.data.created.length} tickets`);
		setJiraTickets(null);
		setSelectedTickets(new Set());
	};

	return (
		<FormProvider {...methods}>
			<SectionHeader title="Jira" description="Connect your Jira project to import tickets directly onto the board." />
			<div className="space-y-4">
				<Field label="Host">
					<RHFInput name="host" placeholder="company.atlassian.net" onChange={(v) => updateJira({ host: v ?? "" })} />
				</Field>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Email">
						<RHFInput name="email" placeholder="you@company.com" onChange={(v) => updateJira({ email: v ?? "" })} />
					</Field>
					<Field label="API Token">
						<RHFInput
							name="token"
							type="password"
							placeholder="••••••••"
							onChange={(v) => updateJira({ token: v ?? "" })}
						/>
					</Field>
				</div>
				<Field label="Project Key">
					<RHFInput name="projectKey" placeholder="ENG" onChange={(v) => updateJira({ projectKey: v ?? "" })} />
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
		</FormProvider>
	);
}
