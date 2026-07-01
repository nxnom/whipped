import type { RuntimeReviewAttachment } from "@runtime-contract";
import { Paperclip, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useRef } from "react";
import { TokenTextarea } from "@/components/TokenTextarea";
import { applyTextareaEdit, atomicTokenEdit, parseAttachmentTokenNumbers } from "@/utils/attachmentTokens";
import { classNames } from "@/utils/classNames";

// One attachment in the editor, keyed by a stable `[Attachment #n]` number.
// `file` is a freshly added upload; `uploaded` is one already persisted on the
// card (edit). Exactly one is set.
export interface EditorAttachment {
	n: number;
	name: string;
	previewUrl: string | null;
	file?: File;
	uploaded?: RuntimeReviewAttachment;
}

interface Props {
	value: string;
	onChange: (value: string) => void;
	attachments: EditorAttachment[];
	setAttachments: Dispatch<SetStateAction<EditorAttachment[]>>;
	/** Sizing for the textarea wrapper, e.g. "flex-1 min-h-0" or "h-36". */
	className?: string;
	placeholder?: string;
	textColorClass?: string;
	autoFocus?: boolean;
}

export function DescriptionAttachmentEditor({
	value,
	onChange,
	attachments,
	setAttachments,
	className,
	placeholder,
	textColorClass = "text-[#ededed]",
	autoFocus,
}: Props) {
	const taRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	// Displayed = whatever tokens are still in the text, in order (stable n).
	const byN = new Map(attachments.map((a) => [a.n, a]));
	const displayed = parseAttachmentTokenNumbers(value)
		.map((n) => byN.get(n))
		.filter((a): a is EditorAttachment => Boolean(a));

	const addFiles = (files: FileList | File[]) => {
		const arr = Array.from(files);
		const ta = taRef.current;
		if (!arr.length || !ta) return;
		const pos = document.activeElement === ta ? ta.selectionStart : ta.value.length;
		const startN = attachments.reduce((max, a) => Math.max(max, a.n), 0);
		const items: EditorAttachment[] = arr.map((file, i) => ({
			n: startN + i + 1,
			name: file.name,
			previewUrl: null,
			file,
		}));
		const before = ta.value.slice(0, pos);
		const lead = before && !/\s$/.test(before) ? " " : "";
		const insert = lead + items.map((it) => `[Attachment #${it.n}]`).join(" ");
		setAttachments((prev) => [...prev, ...items]);
		if (!applyTextareaEdit(ta, pos, pos, insert)) onChange(ta.value.slice(0, pos) + insert + ta.value.slice(pos));
		for (const it of items) {
			if (!it.file?.type.startsWith("image/")) continue;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const url = ev.target?.result as string;
				setAttachments((prev) => prev.map((p) => (p.n === it.n ? { ...p, previewUrl: url } : p)));
			};
			reader.readAsDataURL(it.file);
		}
	};

	const removeByN = (n: number) => {
		const ta = taRef.current;
		if (!ta) return;
		const m = ta.value.match(new RegExp(`\\[Attachment #${n}\\] ?`));
		if (m?.index == null) return;
		const end = m.index + m[0].length;
		if (!applyTextareaEdit(ta, m.index, end, "")) onChange(ta.value.slice(0, m.index) + ta.value.slice(end));
	};

	return (
		<>
			<input
				ref={fileRef}
				type="file"
				accept="*/*"
				multiple
				className="hidden"
				onChange={(e) => {
					if (e.target.files) addFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			<TokenTextarea
				ref={taRef}
				value={value}
				autoFocus={autoFocus}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					const edit = atomicTokenEdit(e);
					if (!edit) return;
					if (!applyTextareaEdit(e.currentTarget, edit.start, edit.end, edit.insert)) {
						onChange(e.currentTarget.value.slice(0, edit.start) + edit.insert + e.currentTarget.value.slice(edit.end));
					}
				}}
				onPaste={(e) => {
					if (e.clipboardData.files.length === 0) return;
					if (!Array.from(e.clipboardData.files).some((f) => f.type.startsWith("image/"))) return;
					e.preventDefault();
					addFiles(e.clipboardData.files);
				}}
				placeholder={placeholder}
				className={classNames("shrink-0", className)}
				metricsClassName={classNames("text-[15px] leading-[1.7] placeholder-[#2a2a2a] h-full p-0", textColorClass)}
			/>

			{displayed.length > 0 && (
				<div className="flex flex-wrap gap-2 shrink-0">
					{displayed.map((a) => (
						<div key={a.n} className="relative group">
							<span className="absolute -top-1 -left-1 z-10 flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold text-white bg-[#3a3a3a]">
								{a.n}
							</span>
							{a.previewUrl ? (
								<img
									src={a.previewUrl}
									alt={a.name}
									className="h-12 w-12 object-cover rounded border border-[#2a2a2a]"
									title={a.name}
								/>
							) : (
								<div
									className="h-12 w-12 flex flex-col items-center justify-center rounded border border-[#2a2a2a] bg-[#111111] gap-1"
									title={a.name}
								>
									<Paperclip size={12} className="text-[#5f6672]" />
									<span className="text-[9px] text-[#5f6672] truncate w-10 text-center px-1">{a.name}</span>
								</div>
							)}
							<button
								type="button"
								onClick={() => removeByN(a.n)}
								className="absolute -top-1 -right-1 size-4 rounded-full bg-[#111111] border border-[#2a2a2a] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
							>
								<X size={9} className="text-[#ededed]" />
							</button>
						</div>
					))}
				</div>
			)}

			<div className="flex items-center gap-2 shrink-0">
				<button
					type="button"
					onClick={() => fileRef.current?.click()}
					className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#2a2a2a] text-[11px] text-[#5f6672] hover:text-[#ededed] hover:border-[#3a3a3a] transition-colors"
				>
					<Paperclip size={12} />
					Attach files
				</button>
			</div>
		</>
	);
}
