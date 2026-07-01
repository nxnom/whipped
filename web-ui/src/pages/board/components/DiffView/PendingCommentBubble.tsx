import { X } from "lucide-react";
import type { PendingComment } from "./types";

export function PendingCommentBubble({
	comment,
	onSave,
	onRemove,
}: {
	comment: PendingComment;
	onSave: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<div className="mx-4 my-1.5 border border-[#eab308]/30 rounded-md bg-[#eab308]/10 p-2.5 font-sans">
			<div className="flex items-start justify-between gap-2">
				<p className="text-xs text-[#eab308]/90 leading-relaxed flex-1">{comment.text}</p>
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={() => onSave(comment.id)}
						className="text-[10px] text-[#8a8f98] hover:text-[#ededed] transition-colors px-1.5 py-0.5 rounded border border-[#2a2a2a] hover:border-white/40"
						title="Save to Comments tab"
					>
						Save
					</button>
					<button
						onClick={() => onRemove(comment.id)}
						className="text-[#5f6672] hover:text-[#ff3b4d] transition-colors"
					>
						<X size={11} />
					</button>
				</div>
			</div>
		</div>
	);
}
