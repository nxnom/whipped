import { toast } from "@geckoui/geckoui";
import type { AgentModelChoice, RecurringAgent, RecurringSchedule } from "@runtime-contract";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { DEFAULT_INTERVAL_SECONDS, DEFAULT_MODEL_CHOICE } from "./constants";
import { ScheduleEditor } from "./ScheduleEditor";

const ACCENT = "#7c6aff";

export function RecurringAgentDialog({
	workspaceId,
	agent,
	onClose,
}: {
	workspaceId: string;
	agent?: RecurringAgent;
	onClose: () => void;
}) {
	const [name, setName] = useState(agent?.name ?? "");
	const [instructions, setInstructions] = useState(agent?.instructions ?? "");
	const [schedule, setSchedule] = useState<RecurringSchedule>(
		agent?.schedule ?? { kind: "interval", intervalSeconds: DEFAULT_INTERVAL_SECONDS },
	);
	const [model, setModel] = useState<AgentModelChoice>(agent?.model ?? DEFAULT_MODEL_CHOICE);
	const [enabled, setEnabled] = useState(agent?.enabled ?? true);

	const create = useWrite((api) => api("recurring-agents").POST());
	const update = useWrite((api) => api("recurring-agents/:id").PATCH());
	const loading = create.loading || update.loading;
	const isEdit = !!agent;

	const handleSave = async () => {
		if (!name.trim()) {
			toast.error("Name is required");
			return;
		}
		const payload = { name: name.trim(), instructions, schedule, model, enabled };
		const res = agent
			? await update.trigger({ params: { id: agent.id }, body: payload })
			: await create.trigger({ body: { workspaceId, ...payload } });
		if (res.error) {
			toast.error(`Failed to ${isEdit ? "update" : "create"} agent`);
			return;
		}
		toast.success(isEdit ? "Agent updated" : "Agent created");
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={onClose} />

			<div className="relative flex h-[620px] max-h-[calc(100vh-80px)] w-[1000px] max-w-[calc(100vw-80px)] rounded-xl bg-[#141418] border border-[#2a2a35] shadow-[0_8px_40px_4px_#00000060] overflow-hidden">
				{/* ── Left panel ── */}
				<div className="flex flex-col flex-1 overflow-hidden">
					<div className="flex items-center gap-3 px-6 py-3.5 border-b border-[#2a2a35] shrink-0">
						<span className="text-[15px] font-semibold text-[#f0f0f5]">
							{isEdit ? "Edit Recurring Agent" : "New Recurring Agent"}
						</span>
						<div className="flex-1" />
						<button onClick={onClose} className="text-[#60607a] hover:text-[#f0f0f5] transition-colors">
							<X size={18} />
						</button>
					</div>

					<div className="flex flex-col flex-1 min-h-0 px-6 py-4 gap-3">
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Agent name — e.g. Security sweep"
							autoFocus
							className="shrink-0 w-full bg-transparent text-[18px] font-semibold text-[#f0f0f5] placeholder:text-[#3a3a45] outline-none"
						/>
						<div className="flex items-center gap-1.5 shrink-0">
							<span className="text-[11px] font-medium text-[#60607a]">Instructions</span>
							<div className="flex-1" />
							<span className="text-[10px] text-[#4a4a5a]">What to do each run, and how to use the journal</span>
						</div>
						<textarea
							value={instructions}
							onChange={(e) => setInstructions(e.target.value)}
							placeholder="Check for new dependency vulnerabilities. File a card for anything not already in your journal."
							className="flex-1 min-h-0 w-full resize-none rounded-lg bg-[#0d0d12] border border-[#2a2a35] px-3.5 py-3 text-[13px] text-[#f0f0f5] placeholder:text-[#3a3a45] outline-none focus:border-[#3a3a48] leading-relaxed"
						/>
					</div>
				</div>

				{/* ── Right config sidebar ── */}
				<div className="w-80 shrink-0 bg-[#111115] border-l border-[#2a2a35] flex flex-col overflow-hidden">
					<div className="px-[18px] py-3.5 border-b border-[#2a2a35] shrink-0">
						<span className="text-xs font-semibold text-[#8888a0]">Configuration</span>
					</div>

					<div className="flex-1 min-h-0 overflow-y-auto px-[18px] py-4 flex flex-col gap-5">
						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Schedule</span>
							<ScheduleEditor value={schedule} onChange={setSchedule} floatingStrategy="fixed" />
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">Agent &amp; Model</span>
							<AgentModelPicker value={model} onChange={setModel} floatingStrategy="fixed" menuClassName="w-fit" />
						</div>
					</div>

					<div className="flex items-center gap-2.5 px-[18px] py-3.5 border-t border-[#2a2a35] shrink-0">
						<button type="button" onClick={() => setEnabled(!enabled)} className="flex items-center gap-1.5">
							<div
								className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
								style={{ background: enabled ? ACCENT : "#2a2a35" }}
							>
								<div
									className="absolute top-0.5 size-3.5 rounded-full bg-white transition-transform"
									style={{ transform: `translateX(${enabled ? 14 : 2}px)` }}
								/>
							</div>
							<span className="text-[11px] text-[#8888a0]">Enabled</span>
						</button>
						<div className="flex-1" />
						<button
							onClick={handleSave}
							disabled={loading || !name.trim()}
							className={classNames(
								"flex items-center gap-1.5 px-5 py-2 rounded-md text-xs font-semibold text-white transition-opacity",
								"disabled:opacity-40 disabled:cursor-not-allowed",
							)}
							style={{ background: ACCENT }}
						>
							<Plus size={14} />
							{loading ? "Saving..." : isEdit ? "Save Changes" : "Create Agent"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
