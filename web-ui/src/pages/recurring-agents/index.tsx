import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { ArrowLeft, Clock, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RecurringAgentDetail } from "./RecurringAgentDetail";
import { RecurringAgentDialog } from "./RecurringAgentDialog";
import { RecurringAgentList } from "./RecurringAgentList";
import { useRecurringAgents } from "./useRecurringAgents";

const POLL_INTERVAL_MS = 5000;

export function RecurringAgentsPage() {
	const navigate = useNavigate();
	const { workspaceId, agentId } = useParams<{ workspaceId: string; agentId: string }>();
	const wsId = workspaceId!;

	const { list, update, remove, runNow, saveJournal } = useRecurringAgents(wsId);
	const agents = list.data ?? [];
	const selected = agents.find((a) => a.id === agentId) ?? null;

	const [dialog, setDialog] = useState<{ open: boolean; agent?: RecurringAgent }>({ open: false });
	const openDialog = (agent?: RecurringAgent) => setDialog({ open: true, agent });

	// Keep run status / next-run fresh while the daemon works in the background.
	useEffect(() => {
		const t = setInterval(() => void list.trigger(), POLL_INTERVAL_MS);
		return () => clearInterval(t);
	}, [list.trigger]);

	// Auto-select the first agent when landing on the page with none selected.
	useEffect(() => {
		if (agentId || agents.length === 0) return;
		navigate(`/${encodeURIComponent(wsId)}/recurring-agents/${encodeURIComponent(agents[0]!.id)}`);
	}, [agentId, agents, wsId, navigate]);

	const select = (id: string) => navigate(`/${encodeURIComponent(wsId)}/recurring-agents/${encodeURIComponent(id)}`);

	const handleToggle = async (enabled: boolean) => {
		if (!selected) return;
		const res = await update.trigger({ params: { id: selected.id }, body: { enabled } });
		if (res.error) toast.error("Failed to update agent");
	};

	const handleRunNow = async () => {
		if (!selected) return;
		const res = await runNow.trigger({ params: { id: selected.id }, query: { workspaceId: wsId } });
		if (res.error) {
			toast.error("Failed to start run");
			return;
		}
		toast.success(res.data?.started ? "Run started" : "Already running");
		void list.trigger();
	};

	const handleSaveJournal = async (journal: string) => {
		if (!selected) return;
		const res = await saveJournal.trigger({ params: { id: selected.id }, body: { journal } });
		if (res.error) {
			toast.error("Failed to save journal");
			return;
		}
		toast.success("Journal saved");
	};

	const handleDelete = () => {
		if (!selected) return;
		const target = selected;
		ConfirmDialog.show({
			title: "Delete recurring agent",
			content: `Delete "${target.name}"? This removes its journal and run history.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				const res = await remove.trigger({ params: { id: target.id } });
				if (res.error) {
					toast.error("Failed to delete agent");
				} else {
					toast.success("Agent deleted");
					navigate(`/${encodeURIComponent(wsId)}/recurring-agents`, { replace: true });
				}
				dismiss();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return (
		<>
			<div className="flex h-full overflow-hidden">
				{/* List rail */}
				<div className="w-[300px] shrink-0 flex flex-col bg-[#141418] border-r border-[#2a2a35]">
					<div className="flex items-center gap-2 px-4 py-4 border-b border-[#2a2a35]">
						<button
							type="button"
							onClick={() => navigate(`/${encodeURIComponent(wsId)}/board`)}
							title="Back to board"
							className="hover:opacity-70 transition-opacity"
						>
							<ArrowLeft size={16} className="text-[#8888a0]" />
						</button>
						<span className="flex-1 text-[14px] font-semibold text-[#f0f0f5]">Recurring Agents</span>
						<button
							type="button"
							onClick={() => openDialog()}
							title="New agent"
							className="hover:opacity-70 transition-opacity"
						>
							<Plus size={16} className="text-[#8888a0]" />
						</button>
					</div>
					<div className="flex-1 overflow-y-auto">
						<RecurringAgentList agents={agents} selectedId={selected?.id ?? null} onSelect={select} />
					</div>
				</div>

				{/* Detail */}
				<div className="flex-1 overflow-hidden flex flex-col min-h-0">
					{selected ? (
						<RecurringAgentDetail
							agent={selected}
							workspaceId={wsId}
							running={runNow.loading}
							savingJournal={saveJournal.loading}
							onToggleEnabled={handleToggle}
							onRunNow={handleRunNow}
							onEdit={() => openDialog(selected)}
							onDelete={handleDelete}
							onSaveJournal={handleSaveJournal}
						/>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
							<div className="flex items-center justify-center size-16 rounded-full bg-[#7c6aff10]">
								<Clock size={28} className="text-[#7c6aff]" />
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-[16px] font-semibold text-[#f0f0f5]">
									{agents.length ? "Select an agent" : "No recurring agents yet"}
								</span>
								<span className="text-[13px] text-[#60607a]">
									Scheduled agents observe your project and report — they don't write code.
								</span>
							</div>
							<Button size="sm" onClick={() => openDialog()}>
								<span className="flex items-center gap-1.5">
									<Plus size={14} /> New agent
								</span>
							</Button>
						</div>
					)}
				</div>
			</div>

			{dialog.open && (
				<RecurringAgentDialog workspaceId={wsId} agent={dialog.agent} onClose={() => setDialog({ open: false })} />
			)}
		</>
	);
}
