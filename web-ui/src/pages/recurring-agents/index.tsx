import { Button, ConfirmDialog, toast } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { Clock, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type DetailTab, RecurringAgentDetail } from "./RecurringAgentDetail";
import { RecurringAgentBar } from "./RecurringAgentBar";
import { RecurringAgentDialog } from "./RecurringAgentDialog";
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

	const [tab, setTab] = useState<DetailTab>("overview");

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

	// Reset to Overview whenever the selected agent changes.
	useEffect(() => {
		setTab("overview");
	}, [agentId]);

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
		setTab("terminal");
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

	const modelLabel = selected
		? [selected.model.agentId, selected.model.model, selected.model.effort].filter(Boolean).join(" · ")
		: "";

	return (
		<>
			<div className="flex flex-col h-full overflow-hidden bg-whip-bg">
				<div className="flex-1 min-h-0 flex flex-col overflow-hidden">
					{selected ? (
						<RecurringAgentDetail
							agent={selected}
							workspaceId={wsId}
							tab={tab}
							onTabChange={setTab}
							savingJournal={saveJournal.loading}
							onSaveJournal={(journal) => void handleSaveJournal(journal)}
						/>
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
							<div className="flex items-center justify-center size-16 rounded-full bg-whip-accent/10">
								<Clock size={28} className="text-whip-accent" />
							</div>
							<div className="flex flex-col gap-1">
								<span className="text-[16px] font-semibold text-whip-text">
									{agents.length ? "Select an agent" : "No recurring agents yet"}
								</span>
								<span className="text-[13px] text-whip-faint">
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

				{selected && (
					<RecurringAgentBar
						agent={selected}
						agents={agents}
						onSelectAgent={select}
						onNewAgent={() => openDialog()}
						modelLabel={modelLabel}
						running={runNow.loading}
						onRunNow={() => void handleRunNow()}
						onEdit={() => openDialog(selected)}
						onToggleEnabled={(enabled) => void handleToggle(enabled)}
						onDelete={handleDelete}
					/>
				)}
			</div>

			{dialog.open && (
				<RecurringAgentDialog workspaceId={wsId} agent={dialog.agent} onClose={() => setDialog({ open: false })} />
			)}
		</>
	);
}
