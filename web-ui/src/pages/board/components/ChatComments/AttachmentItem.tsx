import { Paperclip } from "lucide-react";
import { useState } from "react";
import { attachmentUrl } from "@/runtime/attachments";
import { classNames } from "@/utils/classNames";

export function AttachmentItem({ path, name, mimeType }: { path: string; name: string; mimeType?: string }) {
	const [expanded, setExpanded] = useState(false);
	const isImage = (mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
	if (isImage) {
		return (
			<div className="mt-1">
				<img
					src={attachmentUrl(path)}
					alt={name}
					className={classNames(
						"rounded border border-whip-border cursor-pointer object-contain",
						expanded ? "max-w-full max-h-96" : "max-h-24 max-w-48",
					)}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Click to collapse" : "Click to expand"}
				/>
				<div className="text-[10px] text-whip-faint mt-0.5">{name}</div>
			</div>
		);
	}
	return (
		<a
			href={attachmentUrl(path)}
			target="_blank"
			rel="noreferrer"
			className="mt-1 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-whip-border bg-whip-panel-2 text-xs text-whip-text hover:text-whip-text hover:border-whip-border-hover transition-colors max-w-[200px]"
			title={name}
		>
			<Paperclip size={11} className="shrink-0" />
			<span className="truncate">{name}</span>
		</a>
	);
}
