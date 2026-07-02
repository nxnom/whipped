import {
	Button,
	Checkbox,
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
import { ProjectMultiSelect, type ProjectOption, ProjectTagsBar, TagInput } from "./MemoryTagControls";

const TYPE_LABEL: Record<MemoryType, string> = Object.fromEntries(
	MEMORY_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<MemoryType, string>;

type MemoryDraft = MemoryFormValues & { tags: string[]; boundWorkspaceIds: string[] };

// ── Add / edit dialog ─────────────────────────────────────────────────────────

interface DialogOpts {
	existing?: RuntimeMemory;
	scope: MemoryScope;
	suggestions: string[];
	projects: ProjectOption[];
	currentWorkspaceId: string;
	onSubmit: (draft: MemoryDraft) => Promise<void>;
}

function showMemoryDialog(opts: DialogOpts) {
	Dialog.show({
		className: "max-w-lg w-full",
		content: ({ dismiss }) => <MemoryForm {...opts} dismiss={dismiss} />,
	});
}

function MemoryForm({
	existing,
	scope,
	suggestions,
	projects,
	currentWorkspaceId,
	onSubmit,
	dismiss,
}: DialogOpts & { dismiss: () => void }) {
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

	const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
	const [bindings, setBindings] = useState<string[]>(existing?.boundWorkspaceIds ?? []);

	const submit = handleSubmit(async (values) => {
		if (values.scope === "global" && tags.length === 0) {
			toast.error("Global memory needs at least one tag");
			return;
		}
		try {
			await onSubmit({
				...values,
				title: values.title.trim(),
				content: values.content.trim(),
				tags,
				boundWorkspaceIds: bindings,
			});
			dismiss();
		} catch (err) {
			toast.error((err as Error).message);
		}
	});

	return (
		<FormProvider {...methods}>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<h3 className="text-[15px] font-semibold text-whip-text">{existing ? "Edit memory" : `New ${scope} memory`}</h3>

				<div className="grid grid-cols-2 gap-3">
					<RHFInputGroup label="Type" labelClassName="text-[12px] font-medium text-whip-text">
						<RHFSelect<MemoryType> name="type">
							{MEMORY_TYPE_OPTIONS.map((o) => (
								<SelectOption key={o.value} value={o.value} label={o.label} />
							))}
						</RHFSelect>
					</RHFInputGroup>
					<RHFInputGroup label="Importance" labelClassName="text-[12px] font-medium text-whip-text">
						<RHFSelect<number> name="importance">
							<SelectOption value={1} label="1 — normal" />
							<SelectOption value={2} label="2 — high" />
							<SelectOption value={3} label="3 — critical" />
						</RHFSelect>
					</RHFInputGroup>
				</div>

				<RHFInputGroup label="Title" labelClassName="text-[12px] font-medium text-whip-text">
					<RHFInput name="title" placeholder="Short summary" />
				</RHFInputGroup>

				<RHFInputGroup label="Content" labelClassName="text-[12px] font-medium text-whip-text">
					<RHFTextarea name="content" placeholder="The durable fact / convention / lesson…" rows={6} />
				</RHFInputGroup>

				{scope === "global" && (
					<>
						<div className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-whip-text">Tags</span>
							<TagInput value={tags} onChange={setTags} suggestions={suggestions} />
							<span className="text-[11px] text-whip-faint">
								Required. Projects subscribing to one of these tags will see this memory.
							</span>
						</div>
						<div className="flex flex-col gap-1.5">
							<span className="text-[12px] font-medium text-whip-text">Also bind to specific projects (optional)</span>
							<ProjectMultiSelect
								value={bindings}
								onChange={setBindings}
								projects={projects}
								currentWorkspaceId={currentWorkspaceId}
							/>
						</div>
					</>
				)}

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
	boundToCurrent,
	onToggleBind,
}: {
	memory: RuntimeMemory;
	onEdit: () => void;
	onDelete: () => void;
	onApprove?: () => void;
	boundToCurrent?: boolean;
	onToggleBind?: (bind: boolean) => void;
}) {
	const otherBoundCount = memory.boundWorkspaceIds.length - (boundToCurrent ? 1 : 0);
	return (
		<div className="flex flex-col gap-1.5 bg-whip-panel border border-whip-border rounded-lg px-4 py-3">
			<div className="flex items-center gap-2">
				<span className="text-[10px] font-mono uppercase tracking-wide text-whip-accent bg-whip-accent/15 px-1.5 py-0.5 rounded">
					{TYPE_LABEL[memory.type]}
				</span>
				{memory.importance > 1 && (
					<span className="text-[10px] text-whip-faint">{memory.importance === 3 ? "critical" : "high"}</span>
				)}
				<span className="text-[13px] font-semibold text-whip-text truncate">{memory.title}</span>
				<div className="flex-1" />
				{onToggleBind && (
					<label className="flex items-center gap-1.5 text-[11px] text-whip-muted hover:text-whip-text cursor-pointer">
						<Checkbox checked={boundToCurrent ?? false} onChange={(e) => onToggleBind(e.target.checked)} />
						This project
					</label>
				)}
				{onApprove && (
					<button
						onClick={onApprove}
						title="Approve"
						className="flex items-center gap-1 text-[11px] text-[#22c55e] hover:text-[#22c55e]/80 transition-colors"
					>
						<Check size={13} /> Approve
					</button>
				)}
				<button onClick={onEdit} className="text-[11px] text-whip-muted hover:text-whip-text transition-colors">
					Edit
				</button>
				<button onClick={onDelete} className="text-whip-faint hover:text-[#ff3b4d] transition-colors">
					<Trash2 size={13} />
				</button>
			</div>
			<p className="text-[12px] text-whip-muted whitespace-pre-wrap break-words line-clamp-3">{memory.content}</p>
			{memory.tags.length > 0 && (
				<div className="flex flex-wrap items-center gap-1">
					{memory.tags.map((tag) => (
						<span key={tag} className="text-[10px] text-whip-text bg-whip-border rounded px-1.5 py-0.5">
							{tag}
						</span>
					))}
					{boundToCurrent && (
						<span className="text-[10px] text-whip-accent bg-whip-accent/15 rounded px-1.5 py-0.5">this project</span>
					)}
					{otherBoundCount > 0 && (
						<span className="text-[10px] text-whip-faint">
							+ {otherBoundCount} other project{otherBoundCount > 1 ? "s" : ""}
						</span>
					)}
				</div>
			)}
			{memory.originAgent && (
				<span className="text-[10px] text-whip-faint font-mono">
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

	const { data: knownTags } = useRead((api) => api("memory/tags").GET());
	const { data: workspaceTags } = useRead((api) => api("memory/workspace-tags").GET({ query: { workspaceId } }));
	const { data: projectsData } = useRead((api) => api("projects").GET());

	const suggestions = knownTags ?? [];
	const projects: ProjectOption[] = projectsData ?? [];

	const { trigger: createTrigger } = useWrite((api) => api("memory").POST());
	const { trigger: updateTrigger } = useWrite((api) => api("memory/:id").PATCH());
	const { trigger: tagsTrigger } = useWrite((api) => api("memory/:id/tags").PATCH());
	const { trigger: bindingsTrigger } = useWrite((api) => api("memory/:id/bindings").PATCH());
	const { trigger: approveTrigger } = useWrite((api) => api("memory/:id/approve").POST());
	const { trigger: removeTrigger } = useWrite((api) => api("memory/:id").DELETE());

	const pending = memories.filter((m) => m.status === "pending");
	const approved = memories.filter((m) => m.status === "approved");

	const handleAdd = () => {
		showMemoryDialog({
			scope,
			suggestions,
			projects,
			currentWorkspaceId: workspaceId,
			onSubmit: async (draft) => {
				const res = await createTrigger({
					body: {
						scope,
						workspaceId: scope === "project" ? workspaceId : undefined,
						originWorkspaceId: workspaceId,
						type: draft.type,
						title: draft.title,
						content: draft.content,
						importance: draft.importance,
						tags: scope === "global" ? draft.tags : undefined,
						boundWorkspaceIds: scope === "global" ? draft.boundWorkspaceIds : undefined,
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
			suggestions,
			projects,
			currentWorkspaceId: workspaceId,
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
				if (scope === "global") {
					await tagsTrigger({ params: { id: memory.id }, body: { tags: draft.tags } });
					await bindingsTrigger({ params: { id: memory.id }, body: { workspaceIds: draft.boundWorkspaceIds } });
				}
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

	const handleToggleBind = async (memory: RuntimeMemory, bind: boolean) => {
		const next = bind
			? [...new Set([...memory.boundWorkspaceIds, workspaceId])]
			: memory.boundWorkspaceIds.filter((id) => id !== workspaceId);
		const res = await bindingsTrigger({ params: { id: memory.id }, body: { workspaceIds: next } });
		if (res.error) {
			toast.error(res.error.message);
			return;
		}
		toast(bind ? "Bound to this project" : "Unbound from this project");
		await load();
	};

	return (
		<div className="flex-1 overflow-y-auto px-10 py-6 flex flex-col gap-5">
			{/* Scope tabs + add */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-0 bg-whip-panel border border-whip-border rounded-md p-[2px]">
					{(["project", "global"] as MemoryScope[]).map((s) => (
						<button
							key={s}
							onClick={() => setScope(s)}
							className={classNames(
								"px-3 py-1 text-[12px] rounded transition-colors capitalize",
								scope === s ? "bg-whip-border text-whip-text" : "text-whip-faint hover:text-whip-muted",
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

			{/* Project tag subscriptions (global tab only) */}
			{scope === "global" && (
				<ProjectTagsBar
					key={`${workspaceId}:${(workspaceTags ?? []).join(",")}`}
					workspaceId={workspaceId}
					initialTags={workspaceTags ?? []}
					suggestions={suggestions}
				/>
			)}

			{/* Pending inbox */}
			{pending.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-[12px] font-semibold text-[#eab308]">Pending review ({pending.length})</span>
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
				<span className="text-[12px] font-semibold text-whip-muted">
					{scope === "project" ? "Project memory" : "Global memory"} ({approved.length})
				</span>
				{loading ? (
					<span className="text-[12px] text-whip-faint">Loading…</span>
				) : approved.length === 0 ? (
					<div className="flex flex-col items-center gap-1 py-10 text-center">
						<span className="text-[13px] text-whip-faint">No {scope} memory yet.</span>
						<span className="text-[11px] text-whip-faint">
							Agents add these as they work, or add one manually above.
						</span>
					</div>
				) : (
					approved.map((m) => (
						<MemoryRow
							key={m.id}
							memory={m}
							onEdit={() => handleEdit(m)}
							onDelete={() => handleDelete(m)}
							boundToCurrent={scope === "global" ? m.boundWorkspaceIds.includes(workspaceId) : undefined}
							onToggleBind={scope === "global" ? (bind) => handleToggleBind(m, bind) : undefined}
						/>
					))
				)}
			</div>
		</div>
	);
}
