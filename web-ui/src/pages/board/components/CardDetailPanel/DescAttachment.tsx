import { Paperclip } from "lucide-react";
import { useState } from "react";
import { attachmentUrl } from "@/runtime/attachments";
import { classNames } from "@/utils/classNames";

export function DescAttachment({ path, name, mimeType }: { path: string; name: string; mimeType?: string }) {
	const [expanded, setExpanded] = useState(false);
	const isImage = (mimeType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
	if (isImage) {
		return (
			<div className="relative group">
				<img
					src={attachmentUrl(path)}
					alt={name}
					onClick={() => setExpanded((v) => !v)}
					title={expanded ? "Click to collapse" : name}
					className={classNames(
						"rounded border border-[#2a2a2a] cursor-pointer object-contain",
						expanded ? "max-w-full max-h-64" : "h-16 w-16 object-cover",
					)}
				/>
			</div>
		);
	}
	return (
		<a
			href={attachmentUrl(path)}
			target="_blank"
			rel="noreferrer"
			title={name}
			className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#2a2a2a] bg-[#111111] text-xs text-[#ededed] hover:text-[#ededed] hover:border-[#3a3a3a] transition-colors max-w-[160px] truncate"
		>
			<Paperclip size={11} className="shrink-0" />
			{name}
		</a>
	);
}
