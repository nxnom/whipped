import { ConfirmDialog, toast } from "@geckoui/geckoui";
import { MEMORY_TYPE_OPTIONS, type MemoryType, type RuntimeMemory } from "@runtime-contract";
import { Brain, Check, Trash2 } from "lucide-react";
import { useRead, useWrite } from "@/runtime/api-client";

const TYPE_LABEL: Record<MemoryType, string> = Object.fromEntries(
	MEMORY_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<MemoryType, string>;

// Memories created by agents while working on this card (origin_card_id = cardId).
export function CardMemoryTab({ cardId }: { cardId: string }) {
	const { data, loading, trigger: load } = useRead((api) => api("memory/for-card").GET({ query: { cardId } }));
	const memories: RuntimeMemory[] = data ?? [];

	const { trigger: approveTrigger } = useWrite((api) => api("memory/:id/approve").POST());
	const { trigger: removeTrigger } = useWrite((api) => api("memory/:id").DELETE());

	const approve = async (m: RuntimeMemory) => {
		await approveTrigger({ params: { id: m.id } });
		toast("Approved");
		await load();
	};

	const remove = (m: RuntimeMemory) => {
		ConfirmDialog.show({
			title: "Delete memory",
			content: `Delete "${m.title}"?`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				await removeTrigger({ params: { id: m.id } });
				dismiss();
				await load();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	if (loading) {
		return <div className="flex-1 flex items-center justify-center text-xs text-[#5f6672]">Loading…</div>;
	}

	if (memories.length === 0) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#5f6672]">
				<Brain size={32} className="text-[#3a3a4a]" />
				<p className="text-sm">No memory from this task</p>
				<p className="text-xs text-[#5f6672] max-w-xs text-center">
					When the dev agent saves a durable fact, convention, or lesson while working this card, it shows up here.
				</p>
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
			{memories.map((m) => (
				<div key={m.id} className="flex flex-col gap-1.5 bg-[#111111] border border-[#2a2a2a] rounded-lg px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="text-[10px] font-mono uppercase tracking-wide text-[#8b5cf6] bg-[#8b5cf615] px-1.5 py-0.5 rounded">
							{TYPE_LABEL[m.type]}
						</span>
						<span className="text-[10px] text-[#5f6672]">{m.scope}</span>
						{m.status === "pending" && (
							<span className="text-[10px] text-[#eab308] bg-[#eab308]/10 px-1.5 py-0.5 rounded">pending</span>
						)}
						<span className="text-[13px] font-semibold text-[#ededed] truncate">{m.title}</span>
						<div className="flex-1" />
						{m.status === "pending" && (
							<button
								onClick={() => approve(m)}
								title="Approve"
								className="flex items-center gap-1 text-[11px] text-[#22c55e] hover:text-[#22c55e] transition-colors"
							>
								<Check size={13} /> Approve
							</button>
						)}
						<button onClick={() => remove(m)} className="text-[#5f6672] hover:text-[#ff3b4d] transition-colors">
							<Trash2 size={13} />
						</button>
					</div>
					<p className="text-[12px] text-[#8a8f98] whitespace-pre-wrap break-words">{m.content}</p>
					{m.originAgent && (
						<span className="text-[10px] text-[#5f6672] font-mono">
							from {m.originAgent.agent}
							{m.originAgent.model ? ` · ${m.originAgent.model}` : ""}
						</span>
					)}
				</div>
			))}
		</div>
	);
}
