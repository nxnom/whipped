import { RHFInput, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeJiraTicket, RuntimeProjectConfig } from "@runtime-contract";
import { type JiraConfigValues, jiraConfigSchema } from "@runtime-validation/jira";
import { Download, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

// ─── primitives ───────────────────────────────────────────────────────────────

const fieldContainerClassName = "flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2";
const fieldInputClassName = "text-[#c0c0d0] text-[12px] outline-none bg-transparent";

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[12px] font-medium shrink-0 w-[100px] text-[#8888a0]">{label}</span>
			{children}
		</div>
	);
}

// ─── ticket list ─────────────────────────────────────────────────────────────

function statusStyle(status: string): { bg: string; color: string } {
	const s = status.toLowerCase();
	if (s.includes("open") || s.includes("to do")) return { bg: "#22c55e15", color: "#22c55e" };
	if (s.includes("progress")) return { bg: "#f59e0b15", color: "#f59e0b" };
	if (s.includes("done") || s.includes("closed")) return { bg: "#60607a20", color: "#60607a" };
	return { bg: "#3b82f615", color: "#3b82f6" };
}

function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className={classNames(
				"shrink-0 flex items-center justify-center transition-colors w-4 h-4 rounded-[3px]",
				checked ? "bg-[#7c6aff] border-0" : "bg-transparent border border-[#2a2a35]",
			)}
		>
			{checked && (
				<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
					<path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)}
		</button>
	);
}

function TicketRow({
	ticket,
	selected,
	onToggle,
}: {
	ticket: RuntimeJiraTicket;
	selected: boolean;
	onToggle: () => void;
}) {
	const { bg, color } = statusStyle(ticket.status);
	return (
		<div
			className="flex items-center gap-[10px] px-3.5 py-2.5 border-b border-[#1a1a1f] cursor-pointer"
			style={{ background: selected ? "#7c6aff08" : "transparent" }}
			onClick={onToggle}
		>
			<CustomCheckbox checked={selected} onChange={onToggle} />
			<div className="bg-[#2563eb15] rounded-[4px] px-1.5 py-[2px] shrink-0">
				<span className="font-mono text-[10px] font-semibold text-[#2563eb]">{ticket.key}</span>
			</div>
			<span className="flex-1 text-[12px] truncate text-[#c0c0d0]">{ticket.summary}</span>
			<div className="shrink-0 rounded-[4px] px-1.5 py-[2px]" style={{ background: bg }}>
				<span className="text-[10px]" style={{ color }}>
					{ticket.status}
				</span>
			</div>
		</div>
	);
}

// ─── main component ───────────────────────────────────────────────────────────

const EMPTY_JIRA: JiraConfigValues = { host: "", email: "", token: "", projectKey: "" };

export function IntegrationsSection({
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
	const [tickets, setTickets] = useState<RuntimeJiraTicket[] | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [revealed, setRevealed] = useState(false);

	const methods = useForm<JiraConfigValues>({
		resolver: zodResolver(jiraConfigSchema),
		values: { ...EMPTY_JIRA, ...config.jira },
	});

	const jira = config.jira;
	const isConnected = !!(jira?.host && jira?.email && jira?.token);

	// Push edits back into the parent-owned project config so the existing
	// Save flow persists them. RHF `values` keeps the form in sync the other way.
	const updateJira = (patch: Partial<JiraConfigValues>) =>
		onUpdate({ ...config, jira: { ...EMPTY_JIRA, ...jira, ...patch } });

	const { trigger: fetchTicketsTrigger, loading: fetching } = useRead(
		(api) => api("jira/tickets").GET({ query: { workspaceId } }),
		{ enabled: false },
	);
	const { trigger: importTrigger, loading: importing } = useWrite((api) => api("jira/import").POST());

	const fetchTickets = async () => {
		setTickets(null);
		setSelected(new Set());
		const res = await fetchTicketsTrigger();
		if (res.error || !res.data) {
			toast.error("Failed to fetch Jira tickets. Check your configuration.");
			return;
		}
		setTickets(res.data);
	};

	const handleImport = async () => {
		if (selected.size === 0) return;
		const res = await importTrigger({ body: { workspaceId, ticketKeys: Array.from(selected) } });
		if (res.error || !res.data) {
			toast.error("Failed to import tickets");
			return;
		}
		const count = res.data.created.length;
		toast.success(`Imported ${count} ticket${count !== 1 ? "s" : ""}`);
		setTickets(null);
		setSelected(new Set());
	};

	const toggleTicket = (key: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	};

	return (
		<FormProvider {...methods}>
			<div className="flex flex-col gap-6">
				{/* Jira card */}
				<div className="bg-[#141418] border border-[#2a2a35] rounded-[10px]">
					{/* Card header */}
					<div className="flex items-center gap-3 px-5 py-4 border-b border-[#2a2a35]">
						{/* Jira logo */}
						<div className="flex items-center justify-center shrink-0 text-[16px] font-bold w-8 h-8 bg-[#2563eb15] rounded-lg text-[#2563eb]">
							J
						</div>

						{/* Title */}
						<div className="flex flex-col gap-0.5">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">Jira</span>
							<span className="text-[11px] text-[#60607a]">Import tickets from Jira projects</span>
						</div>

						<div className="flex-1" />

						{/* Connection status */}
						{isConnected ? (
							<div className="flex items-center gap-1.5 bg-[#22c55e15] rounded-[10px] px-2.5 py-[3px]">
								<div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
								<span className="text-[10px] font-medium text-[#22c55e]">Connected</span>
							</div>
						) : (
							<div className="flex items-center gap-1.5 bg-[#60607a20] rounded-[10px] px-2.5 py-[3px]">
								<div className="w-1.5 h-1.5 rounded-full bg-[#60607a]" />
								<span className="text-[10px] font-medium text-[#60607a]">Not connected</span>
							</div>
						)}
					</div>

					{/* Card body */}
					<div className="flex flex-col gap-3.5 p-5">
						<FieldRow label="Host">
							<RHFInput
								name="host"
								className={fieldContainerClassName}
								inputClassName={fieldInputClassName}
								placeholder="company.atlassian.net"
								onChange={(v) => updateJira({ host: v ?? "" })}
							/>
						</FieldRow>
						<FieldRow label="Email">
							<RHFInput
								name="email"
								className={fieldContainerClassName}
								inputClassName={fieldInputClassName}
								placeholder="you@company.com"
								onChange={(v) => updateJira({ email: v ?? "" })}
							/>
						</FieldRow>
						<FieldRow label="API Token">
							<RHFInput
								name="token"
								type={revealed ? "text" : "password"}
								className={classNames("flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2")}
								inputClassName={classNames(
									"font-mono text-[12px] outline-none bg-transparent",
									revealed ? "text-[#c0c0d0]" : "text-[#60607a]",
								)}
								placeholder="••••••••••••••••"
								onChange={(v) => updateJira({ token: v ?? "" })}
								suffix={
									<button
										type="button"
										onClick={() => setRevealed((r) => !r)}
										className="shrink-0 hover:opacity-70 transition-opacity text-[#60607a]"
									>
										{revealed ? <EyeOff size={14} /> : <Eye size={14} />}
									</button>
								}
							/>
						</FieldRow>
						<FieldRow label="Project Key">
							<RHFInput
								name="projectKey"
								className={fieldContainerClassName}
								inputClassName={fieldInputClassName}
								placeholder="ENG"
								onChange={(v) => updateJira({ projectKey: v ?? "" })}
							/>
						</FieldRow>

						<div className="h-px bg-[#2a2a35]" />

						{/* Import Tickets */}
						<div className="flex items-center gap-3">
							<span className="text-[13px] font-semibold text-[#f0f0f5]">Import Tickets</span>
							<div className="flex-1" />
							<button
								onClick={fetchTickets}
								disabled={fetching || !isConnected}
								className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-40 bg-[#7c6aff] rounded-md px-3.5 py-[7px] text-white"
							>
								<RefreshCw size={13} className={fetching ? "animate-spin" : ""} />
								<span className="text-[12px] font-medium">Fetch Tickets</span>
							</button>
						</div>

						{/* Ticket list */}
						{tickets && tickets.length > 0 && (
							<>
								<div className="bg-[#0c0c0f] border border-[#2a2a35] rounded-md overflow-hidden">
									{tickets.map((t) => (
										<TicketRow
											key={t.key}
											ticket={t}
											selected={selected.has(t.key)}
											onToggle={() => toggleTicket(t.key)}
										/>
									))}
								</div>
								<div className="flex items-center justify-end gap-2.5">
									{selected.size > 0 && <span className="text-[12px] text-[#60607a]">{selected.size} selected</span>}
									<button
										onClick={handleImport}
										disabled={selected.size === 0 || importing}
										className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-40 bg-[#7c6aff] rounded-md px-3.5 py-[7px] text-white"
									>
										<Download size={13} />
										<span className="text-[12px] font-medium">
											{importing ? "Importing..." : `Import${selected.size > 0 ? ` ${selected.size}` : ""}`}
										</span>
									</button>
								</div>
							</>
						)}

						{tickets && tickets.length === 0 && (
							<p className="text-[12px] text-center py-3 text-[#4a4a5a]">No open tickets found</p>
						)}
					</div>
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<button
						onClick={onSave}
						disabled={saving}
						className="text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50 bg-[#7c6aff] text-white"
					>
						{saving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</FormProvider>
	);
}
