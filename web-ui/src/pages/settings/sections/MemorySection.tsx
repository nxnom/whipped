import {
	Button,
	ConfirmDialog,
	Dialog,
	RHFInput,
	RHFInputGroup,
	RHFSelect,
	RHFTextarea,
	SelectOption,
	toast,
} from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { MEMORY_TYPE_OPTIONS, type MemoryScope, type MemoryType, type RuntimeMemory } from "@runtime-contract";
import { type MemoryFormValues, memoryFormSchema } from "@runtime-validation/memory";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

const TYPE_LABEL: Record<MemoryType, string> = Object.fromEntries(
	MEMORY_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<MemoryType, string>;

// ── Add / edit dialog ─────────────────────────────────────────────────────────

function showMemoryDialog(opts: {
	existing?: RuntimeMemory;
	scope: MemoryScope;
	onSubmit: (draft: MemoryFormValues) => Promise<void>;
}) {
	Dialog.show({
		className: "max-w-lg w-full",
		content: ({ dismiss }) => <MemoryForm {...opts} dismiss={dismiss} />,
	});
}

function MemoryForm({
	existing,
	scope,
	onSubmit,
	dismiss,
}: {
	existing?: RuntimeMemory;
	scope: MemoryScope;
	onSubmit: (draft: MemoryFormValues) => Promise<void>;
	dismiss: () => void;
}) {
	const methods = useForm<MemoryFormValues>({
		resolver: zodResolver(memoryFormSchema),
		values: {
			type: existing?.type ?? "fact",
			title: existing?.title ?? "",
			content: existing?.content ?? "",
			importance: existing?.importance ?? 1,
			scope,
		},
	});
	const {
		handleSubmit,
		formState: { isSubmitting },
	} = methods;

	const submit = handleSubmit(async (values) => {
		try {
			await onSubmit({ ...values, title: values.title.trim(), content: values.content.trim() });
			dismiss();
		} catch (err) {
			toast.error((err as Error).message);
		}
	});

	return (
		<FormProvider {...methods}>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<h3 className="text-[15px] font-semibold text-[#f0f0f5]">{existing ? "Edit memory" : `New ${scope} memory`}</h3>

				<div className="grid grid-cols-2 gap-3">
					<RHFInputGroup label="Type" labelClassName="text-[12px] font-medium text-[#c0c0d0]">
						<RHFSelect<MemoryType> name="type">
							{MEMORY_TYPE_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</RHFSelect>
					</RHFInputGroup>
					<RHFInputGroup label="Importance" labelClassName="text-[12px] font-medium text-[#c0c0d0]">
						<RHFSelect<number> name="importance">
							<SelectOption value={1} label="1 — normal" />
							<SelectOption value={2} label="2 — high" />
							<SelectOption value={3} label="3 — critical" />
						</RHFSelect>
					</RHFInputGroup>
				</div>

				<RHFInputGroup label="Title" labelClassName="text-[12px] font-medium text-[#c0c0d0]">
					<RHFInput name="title" placeholder="Short summary" />
				</RHFInputGroup>

				<RHFInputGroup label="Content" labelClassName="text-[12px] font-medium text-[#c0c0d0]">
					<RHFTextarea name="content" placeholder="The durable fact / convention / lesson…" rows={6} />
				</RHFInputGroup>

				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={dismiss}>
						Cancel
					</Button>
					<Button type="submit" disabled={isSubmitting}>
						{existing ? "Save" : "Add"}
					</Button>
				</div>
			</form>
		</FormProvider>
	);
}

// ── Memory row ──────────────────────────────────────────────────────────────

function MemoryRow({
	memory,
	onEdit,
	onDelete,
	onApprove,
}: {
	memory: RuntimeMemory;
	onEdit: () => void;
	onDelete: () => void;
	onApprove?: () => void;
}) {
	return (
		<div className="flex flex-col gap-1.5 bg-[#0c0c0f] border border-[#2a2a35] rounded-lg px-4 py-3">
			<div className="flex items-center gap-2">
				<span className="text-[10px] font-mono uppercase tracking-wide text-[#7c6aff] bg-[#7c6aff15] px-1.5 py-0.5 rounded">
					{TYPE_LABEL[memory.type]}
				</span>
				{memory.importance > 1 && (
					<span className="text-[10px] text-[#60607a]">{memory.importance === 3 ? "critical" : "high"}</span>
				)}
				<span className="text-[13px] font-semibold text-[#f0f0f5] truncate">{memory.title}</span>
				<div className="flex-1" />
				{onApprove && (
					<button
						onClick={onApprove}
						title="Approve"
						className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
					>
						<Check size={13} /> Approve
					</button>
				)}
				<button onClick={onEdit} className="text-[11px] text-[#8888a0] hover:text-[#c0c0d0] transition-colors">
					Edit
				</button>
				<button onClick={onDelete} className="text-[#60607a] hover:text-red-400 transition-colors">
					<Trash2 size={13} />
				</button>
			</div>
			<p className="text-[12px] text-[#8888a0] whitespace-pre-wrap break-words line-clamp-3">{memory.content}</p>
			{memory.originAgent && (
				<span className="text-[10px] text-[#4a4a5a] font-mono">
					from {memory.originAgent.agent}
					{memory.originAgent.model ? ` · ${memory.originAgent.model}` : ""}
				</span>
			)}
		</div>
	);
}

// ── Main section ──────────────────────────────────────────────────────────────

export function MemorySection({ workspaceId }: { workspaceId: string }) {
	const [scope, setScope] = useState<MemoryScope>("project");

	const {
		data,
		loading,
		trigger: load,
	} = useRead((api) =>
		api("memory").GET({ query: { scope, workspaceId: scope === "project" ? workspaceId : undefined } }),
	);
	const memories: RuntimeMemory[] = data ?? [];

	const { trigger: createTrigger } = useWrite((api) => api("memory").POST());
	const { trigger: updateTrigger } = useWrite((api) => api("memory/:id").PATCH());
	const { trigger: approveTrigger } = useWrite((api) => api("memory/:id/approve").POST());
	const { trigger: removeTrigger } = useWrite((api) => api("memory/:id").DELETE());

	const pending = memories.filter((m) => m.status === "pending");
	const approved = memories.filter((m) => m.status === "approved");

	const handleAdd = () => {
		showMemoryDialog({
			scope,
			onSubmit: async (draft) => {
				const res = await createTrigger({
					body: {
						scope,
						workspaceId: scope === "project" ? workspaceId : undefined,
						type: draft.type,
						title: draft.title,
						content: draft.content,
						importance: draft.importance,
					},
				});
				if (res.error) throw new Error(res.error.message);
				toast("Memory added");
				await load();
			},
		});
	};

	const handleEdit = (memory: RuntimeMemory) => {
		showMemoryDialog({
			existing: memory,
			scope,
			onSubmit: async (draft) => {
				const res = await updateTrigger({
					params: { id: memory.id },
					body: {
						type: draft.type,
						title: draft.title,
						content: draft.content,
						importance: draft.importance,
					},
				});
				if (res.error) throw new Error(res.error.message);
				toast("Memory updated");
				await load();
			},
		});
	};

	const handleDelete = (memory: RuntimeMemory) => {
		ConfirmDialog.show({
			title: "Delete memory",
			content: `Delete "${memory.title}"? This cannot be undone.`,
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				await removeTrigger({ params: { id: memory.id } });
				dismiss();
				await load();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleApprove = async (memory: RuntimeMemory) => {
		await approveTrigger({ params: { id: memory.id } });
		toast("Approved");
		await load();
	};

	return (
		<div className="flex-1 overflow-y-auto px-10 py-6 flex flex-col gap-5">
			{/* Scope tabs + add */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-0 bg-[#0c0c0f] border border-[#2a2a35] rounded-md p-[2px]">
					{(["project", "global"] as MemoryScope[]).map((s) => (
						<button
							key={s}
							onClick={() => setScope(s)}
							className={classNames(
								"px-3 py-1 text-[12px] rounded transition-colors capitalize",
								scope === s ? "bg-[#2a2a35] text-[#f0f0f5]" : "text-[#60607a] hover:text-[#8888a0]",
							)}
						>
							{s}
						</button>
					))}
				</div>
				<div className="flex-1" />
				<Button size="sm" onClick={handleAdd}>
					<span className="flex items-center gap-1.5">
						<Plus size={13} /> Add memory
					</span>
				</Button>
			</div>

			{/* Pending inbox */}
			{pending.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-[12px] font-semibold text-amber-400">Pending review ({pending.length})</span>
					{pending.map((m) => (
						<MemoryRow
							key={m.id}
							memory={m}
							onEdit={() => handleEdit(m)}
							onDelete={() => handleDelete(m)}
							onApprove={() => handleApprove(m)}
						/>
					))}
				</div>
			)}

			{/* Approved */}
			<div className="flex flex-col gap-2">
				<span className="text-[12px] font-semibold text-[#8888a0]">
					{scope === "project" ? "Project memory" : "Global memory"} ({approved.length})
				</span>
				{loading ? (
					<span className="text-[12px] text-[#4a4a5a]">Loading…</span>
				) : approved.length === 0 ? (
					<div className="flex flex-col items-center gap-1 py-10 text-center">
						<span className="text-[13px] text-[#60607a]">No {scope} memory yet.</span>
						<span className="text-[11px] text-[#4a4a5a]">
							Agents add these as they work, or add one manually above.
						</span>
					</div>
				) : (
					approved.map((m) => (
						<MemoryRow key={m.id} memory={m} onEdit={() => handleEdit(m)} onDelete={() => handleDelete(m)} />
					))
				)}
			</div>
		</div>
	);
}
