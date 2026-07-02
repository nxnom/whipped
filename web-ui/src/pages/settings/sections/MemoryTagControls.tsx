import { Checkbox, toast } from "@geckoui/geckoui";
import { normalizeTag } from "@runtime-contract";
import { X } from "lucide-react";
import { useState } from "react";
import { useWrite } from "@/runtime/api-client";

// Chip input for canonical tags. New entries are normalised; existing tags are
// offered as one-click suggestions to keep the vocabulary from fragmenting.
export function TagInput({
	value,
	onChange,
	suggestions = [],
}: {
	value: string[];
	onChange: (next: string[]) => void;
	suggestions?: string[];
}) {
	const [draft, setDraft] = useState("");

	const add = (raw: string) => {
		const tag = normalizeTag(raw);
		if (!tag || value.includes(tag)) return;
		onChange([...value, tag]);
		setDraft("");
	};
	const remove = (tag: string) => onChange(value.filter((t) => t !== tag));
	const unused = suggestions.filter((s) => !value.includes(s)).slice(0, 12);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-1.5 bg-whip-panel border border-whip-border rounded-md px-2 py-1.5">
				{value.map((tag) => (
					<span
						key={tag}
						className="flex items-center gap-1 text-[11px] text-whip-text bg-whip-border rounded px-1.5 py-0.5"
					>
						{tag}
						<button type="button" onClick={() => remove(tag)} className="text-whip-faint hover:text-[#ff3b4d]">
							<X size={11} />
						</button>
					</span>
				))}
				<input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === ",") {
							e.preventDefault();
							add(draft);
						} else if (e.key === "Backspace" && !draft && value.length > 0) {
							const last = value[value.length - 1];
							if (last) remove(last);
						}
					}}
					placeholder={value.length > 0 ? "" : "add tag…"}
					className="flex-1 min-w-[80px] bg-transparent text-[12px] text-whip-text outline-none placeholder:text-whip-faint"
				/>
			</div>
			{unused.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{unused.map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => add(s)}
							className="text-[10px] text-whip-muted hover:text-whip-text border border-whip-border rounded px-1.5 py-0.5"
						>
							+ {s}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export interface ProjectOption {
	workspaceId: string;
	name?: string;
	repoPath: string;
}

function projectLabel(p: ProjectOption): string {
	return p.name || p.repoPath.split("/").filter(Boolean).at(-1) || p.workspaceId;
}

// Checkbox list to bind a global memory to specific projects by id.
export function ProjectMultiSelect({
	value,
	onChange,
	projects,
	currentWorkspaceId,
}: {
	value: string[];
	onChange: (next: string[]) => void;
	projects: ProjectOption[];
	currentWorkspaceId: string;
}) {
	const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

	return (
		<div className="flex flex-col gap-1 max-h-40 overflow-y-auto bg-whip-panel border border-whip-border rounded-md p-2">
			{projects.map((p) => (
				<label
					key={p.workspaceId}
					className="flex items-center gap-2 text-[12px] text-whip-text cursor-pointer hover:text-whip-text"
				>
					<Checkbox checked={value.includes(p.workspaceId)} onChange={() => toggle(p.workspaceId)} />
					<span className="truncate">
						{projectLabel(p)}
						{p.workspaceId === currentWorkspaceId ? " (this project)" : ""}
					</span>
				</label>
			))}
			{projects.length === 0 && <span className="text-[11px] text-whip-faint">No projects.</span>}
		</div>
	);
}

// Editor for the tags this project subscribes to. Changes apply immediately —
// remounted (via key) when the loaded tags change so the draft seeds from the
// saved value.
export function ProjectTagsBar({
	workspaceId,
	initialTags,
	suggestions,
}: {
	workspaceId: string;
	initialTags: string[];
	suggestions: string[];
}) {
	const [tags, setTags] = useState<string[]>(initialTags);
	const { trigger: save } = useWrite((api) => api("memory/workspace-tags").PUT());

	const apply = async (next: string[]) => {
		setTags(next);
		const res = await save({ body: { workspaceId, tags: next } });
		if (res.error) toast.error(res.error.message);
	};

	return (
		<div className="flex flex-col gap-2 bg-whip-panel border border-whip-border rounded-lg px-4 py-3">
			<span className="text-[12px] font-semibold text-whip-text">Tags this project subscribes to</span>
			<TagInput value={tags} onChange={apply} suggestions={suggestions} />
			<span className="text-[11px] text-whip-faint">
				A global memory reaches this project when it shares one of these tags.
			</span>
		</div>
	);
}
