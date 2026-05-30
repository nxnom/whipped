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
		<div className="mx-4 my-1.5 border border-yellow-800/40 rounded-md bg-yellow-950/20 p-2.5 font-sans">
			<div className="flex items-start justify-between gap-2">
				<p className="text-xs text-yellow-200/90 leading-relaxed flex-1">{comment.text}</p>
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={() => onSave(comment.id)}
						className="text-[10px] text-gray-400 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded border border-gray-700 hover:border-blue-600"
						title="Save to Comments tab"
					>
						Save
					</button>
					<button onClick={() => onRemove(comment.id)} className="text-gray-600 hover:text-red-400 transition-colors">
						<X size={11} />
					</button>
				</div>
			</div>
		</div>
	);
}
