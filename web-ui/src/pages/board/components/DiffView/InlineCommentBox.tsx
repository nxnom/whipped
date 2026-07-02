import { Button } from "@geckoui/geckoui";
import type React from "react";

export function InlineCommentBox({
	draftRef,
	value,
	onChange,
	onAdd,
	onCancel,
}: {
	draftRef: React.RefObject<HTMLTextAreaElement>;
	value: string;
	onChange: (v: string) => void;
	onAdd: () => void;
	onCancel: () => void;
}) {
	return (
		<div className="mx-4 my-2 font-sans">
			<div className="rounded-lg border border-whip-border bg-whip-bg focus-within:border-whip-border-hover transition-colors">
				<textarea
					ref={draftRef}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							onAdd();
						}
						if (e.key === "Escape") onCancel();
					}}
					placeholder="Add a comment…"
					rows={2}
					className="w-full bg-transparent text-sm text-whip-text px-3 pt-3 pb-1 resize-none outline-none placeholder-whip-faint"
				/>
				<div className="flex items-center justify-between px-3 pb-2">
					<span className="text-[10px] text-whip-faint">↵ Add · ⇧↵ Newline · Esc Cancel</span>
					<Button size="sm" onClick={onAdd} disabled={!value.trim()}>
						Add
					</Button>
				</div>
			</div>
		</div>
	);
}
