import type { RuntimeJiraTicket, RuntimeProjectConfig } from "@runtime-contract";
import { Download, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "@geckoui/geckoui";
import { trpc } from "@/runtime/trpc-client";

// ─── primitives ───────────────────────────────────────────────────────────────

const fieldInputStyle: React.CSSProperties = {
	flex: 1,
	background: "#0c0c0f",
	border: "1px solid #2a2a35",
	borderRadius: 6,
	padding: "8px 12px",
	color: "#c0c0d0",
	fontSize: 12,
	outline: "none",
};

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[12px] font-medium shrink-0" style={{ width: 100, color: "#8888a0" }}>
				{label}
			</span>
			{children}
		</div>
	);
}

function TextInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
}) {
	return (
		<input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={fieldInputStyle} />
	);
}

function PasswordInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<div className="flex items-center gap-2 flex-1" style={{ ...fieldInputStyle, padding: "8px 12px" }}>
			<input
				type={revealed ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="••••••••••••••••"
				className="flex-1 bg-transparent focus:outline-none font-mono text-[12px] min-w-0"
				style={{ color: revealed ? "#c0c0d0" : "#60607a" }}
			/>
			<button
				type="button"
				onClick={() => setRevealed((v) => !v)}
				className="shrink-0 hover:opacity-70 transition-opacity"
				style={{ color: "#60607a" }}
			>
				{revealed ? <EyeOff size={14} /> : <Eye size={14} />}
			</button>
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
			className="shrink-0 flex items-center justify-center transition-colors"
			style={{
				width: 16,
				height: 16,
				borderRadius: 3,
				background: checked ? "#7c6aff" : "transparent",
				border: checked ? "none" : "1px solid #2a2a35",
			}}
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
			className="flex items-center gap-[10px] cursor-pointer"
			style={{
				padding: "10px 14px",
				background: selected ? "#7c6aff08" : "transparent",
				borderBottom: "1px solid #1a1a1f",
			}}
			onClick={onToggle}
		>
			<CustomCheckbox checked={selected} onChange={onToggle} />
			<div
				style={{
					background: "#2563eb15",
					borderRadius: 4,
					padding: "2px 6px",
					flexShrink: 0,
				}}
			>
				<span className="font-mono text-[10px] font-semibold" style={{ color: "#2563eb" }}>
					{ticket.key}
				</span>
			</div>
			<span className="flex-1 text-[12px] truncate" style={{ color: "#c0c0d0" }}>
				{ticket.summary}
			</span>
			<div style={{ background: bg, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>
				<span className="text-[10px]" style={{ color }}>
					{ticket.status}
				</span>
			</div>
		</div>
	);
}

// ─── main component ───────────────────────────────────────────────────────────

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
	const [fetching, setFetching] = useState(false);
	const [importing, setImporting] = useState(false);

	const jira = config.jira;
	const isConnected = !!(jira?.host && jira?.email && jira?.token);

	const updateJira = (patch: Partial<typeof jira>) =>
		onUpdate({ ...config, jira: { host: "", email: "", token: "", projectKey: "", ...jira, ...patch } });

	const fetchTickets = async () => {
		setFetching(true);
		setTickets(null);
		setSelected(new Set());
		try {
			const result = await trpc.jira.fetchTickets.query({ workspaceId });
			setTickets(result);
		} catch {
			toast.error("Failed to fetch Jira tickets. Check your configuration.");
		} finally {
			setFetching(false);
		}
	};

	const handleImport = async () => {
		if (selected.size === 0) return;
		setImporting(true);
		try {
			const result = await trpc.jira.importTickets.mutate({
				workspaceId,
				ticketKeys: Array.from(selected),
			});
			toast.success(`Imported ${result.created.length} ticket${result.created.length !== 1 ? "s" : ""}`);
			setTickets(null);
			setSelected(new Set());
		} catch {
			toast.error("Failed to import tickets");
		} finally {
			setImporting(false);
		}
	};

	const toggleTicket = (key: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(key) ? next.delete(key) : next.add(key);
			return next;
		});
	};

	return (
		<div className="flex flex-col gap-6">
			{/* Jira card */}
			<div
				style={{
					background: "#141418",
					border: "1px solid #2a2a35",
					borderRadius: 10,
				}}
			>
				{/* Card header */}
				<div className="flex items-center gap-3" style={{ padding: "16px 20px", borderBottom: "1px solid #2a2a35" }}>
					{/* Jira logo */}
					<div
						className="flex items-center justify-center shrink-0 text-[16px] font-bold"
						style={{
							width: 32,
							height: 32,
							background: "#2563eb15",
							borderRadius: 8,
							color: "#2563eb",
							fontFamily: "Inter, sans-serif",
						}}
					>
						J
					</div>

					{/* Title */}
					<div className="flex flex-col gap-0.5">
						<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>
							Jira
						</span>
						<span className="text-[11px]" style={{ color: "#60607a" }}>
							Import tickets from Jira projects
						</span>
					</div>

					<div className="flex-1" />

					{/* Connection status */}
					{isConnected ? (
						<div
							className="flex items-center gap-1.5"
							style={{ background: "#22c55e15", borderRadius: 10, padding: "3px 10px" }}
						>
							<div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
							<span className="text-[10px] font-medium" style={{ color: "#22c55e" }}>
								Connected
							</span>
						</div>
					) : (
						<div
							className="flex items-center gap-1.5"
							style={{ background: "#60607a20", borderRadius: 10, padding: "3px 10px" }}
						>
							<div style={{ width: 6, height: 6, borderRadius: "50%", background: "#60607a" }} />
							<span className="text-[10px] font-medium" style={{ color: "#60607a" }}>
								Not connected
							</span>
						</div>
					)}
				</div>

				{/* Card body */}
				<div className="flex flex-col gap-3.5" style={{ padding: 20 }}>
					<FieldRow label="Host">
						<TextInput
							value={jira?.host ?? ""}
							onChange={(v) => updateJira({ host: v })}
							placeholder="company.atlassian.net"
						/>
					</FieldRow>
					<FieldRow label="Email">
						<TextInput
							value={jira?.email ?? ""}
							onChange={(v) => updateJira({ email: v })}
							placeholder="you@company.com"
						/>
					</FieldRow>
					<FieldRow label="API Token">
						<PasswordInput value={jira?.token ?? ""} onChange={(v) => updateJira({ token: v })} />
					</FieldRow>
					<FieldRow label="Project Key">
						<TextInput
							value={jira?.projectKey ?? ""}
							onChange={(v) => updateJira({ projectKey: v })}
							placeholder="ENG"
						/>
					</FieldRow>

					<div style={{ height: 1, background: "#2a2a35" }} />

					{/* Import Tickets */}
					<div className="flex items-center gap-3">
						<span className="text-[13px] font-semibold" style={{ color: "#f0f0f5" }}>
							Import Tickets
						</span>
						<div className="flex-1" />
						<button
							onClick={fetchTickets}
							disabled={fetching || !isConnected}
							className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-40"
							style={{
								background: "#7c6aff",
								borderRadius: 6,
								padding: "7px 14px",
								color: "#ffffff",
							}}
						>
							<RefreshCw size={13} className={fetching ? "animate-spin" : ""} />
							<span className="text-[12px] font-medium">Fetch Tickets</span>
						</button>
					</div>

					{/* Ticket list */}
					{tickets && tickets.length > 0 && (
						<>
							<div
								style={{
									background: "#0c0c0f",
									border: "1px solid #2a2a35",
									borderRadius: 6,
									overflow: "hidden",
								}}
							>
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
								{selected.size > 0 && (
									<span className="text-[12px]" style={{ color: "#60607a" }}>
										{selected.size} selected
									</span>
								)}
								<button
									onClick={handleImport}
									disabled={selected.size === 0 || importing}
									className="flex items-center gap-1.5 hover:opacity-80 transition-opacity disabled:opacity-40"
									style={{
										background: "#7c6aff",
										borderRadius: 6,
										padding: "7px 14px",
										color: "#ffffff",
									}}
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
						<p className="text-[12px] text-center py-3" style={{ color: "#4a4a5a" }}>
							No open tickets found
						</p>
					)}
				</div>
			</div>

			{/* Save */}
			<div className="flex justify-end">
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
