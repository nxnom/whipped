import { Paperclip, X } from "lucide-react";
import { useRef } from "react";
import type { PendingImage } from "./types";

export function ImagePicker({
	pending,
	onChange,
}: {
	pending: PendingImage[];
	onChange: (imgs: PendingImage[]) => void;
}) {
	const ref = useRef<HTMLInputElement>(null);
	const addFiles = (files: FileList | File[]) => {
		Array.from(files).forEach((file) => {
			if (file.type.startsWith("image/")) {
				const r = new FileReader();
				r.onload = (ev) => onChange([...pending, { dataUrl: ev.target?.result as string, file }]);
				r.readAsDataURL(file);
			} else {
				onChange([...pending, { dataUrl: null, file }]);
			}
		});
	};
	if (pending.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-2 mt-2 shrink-0">
			<input
				ref={ref}
				type="file"
				accept="*/*"
				multiple
				className="hidden"
				onChange={(e) => {
					if (e.target.files) addFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			{pending.map((img, i) => (
				<div key={i} className="relative group">
					{img.dataUrl ? (
						<img
							src={img.dataUrl}
							alt={img.file.name}
							className="h-12 w-12 object-cover rounded border border-[#2a2a35]"
						/>
					) : (
						<div className="h-12 w-12 flex flex-col items-center justify-center rounded border border-[#2a2a35] bg-[#1a1a1f] gap-1">
							<Paperclip size={12} className="text-[#60607a]" />
							<span className="text-[9px] text-[#60607a] truncate w-10 text-center px-1">{img.file.name}</span>
						</div>
					)}
					<button
						type="button"
						onClick={() => onChange(pending.filter((_, j) => j !== i))}
						className="absolute -top-1 -right-1 size-4 rounded-full bg-[#1a1a1f] border border-[#2a2a35] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
					>
						<X size={9} className="text-[#f0f0f5]" />
					</button>
				</div>
			))}
		</div>
	);
}
