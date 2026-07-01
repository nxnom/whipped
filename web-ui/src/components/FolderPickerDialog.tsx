import { ArrowLeft, ChevronRight, Folder, FolderOpen, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRead } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";

interface Props {
	initialPath?: string;
	onSelect: (path: string) => void;
	onClose: () => void;
}

export function FolderPickerDialog({ initialPath, onSelect, onClose }: Props) {
	const [path, setPath] = useState(initialPath ?? "");
	const [selected, setSelected] = useState<string | null>(null);
	const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Declarative read keyed on `path` — refetches automatically as you navigate.
	const { data, fetching: loading } = useRead((api) => api("fs/list-dir").GET({ query: { path } }));
	const listing = data ?? null;

	const navigate = (next: string) => {
		setSelected(null);
		setPath(next);
	};

	const handleConfirm = () => {
		const path = selected ?? listing?.current;
		if (path) onSelect(path);
	};

	const handleRowClick = (path: string) => {
		if (clickTimer.current) {
			clearTimeout(clickTimer.current);
			clickTimer.current = null;
			navigate(path);
		} else {
			setSelected((prev) => (prev === path ? null : path));
			clickTimer.current = setTimeout(() => {
				clickTimer.current = null;
			}, 300);
		}
	};

	return (
		<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
			<div
				className="flex flex-col overflow-hidden w-[520px] max-h-[70vh] bg-[#0b0b0b] border border-[#2a2a2a] rounded-xl shadow-[0_8px_40px_4px_#00000060]"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center shrink-0 gap-2.5 px-5 py-4 border-b border-[#2a2a2a]">
					<FolderOpen size={15} className="text-[#ffffff] shrink-0" />
					<span className="flex-1 truncate text-[12px] text-[#ededed] font-mono">{listing?.current ?? "…"}</span>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={15} className="text-[#5f6672]" />
					</button>
				</div>

				{/* Directory list */}
				<div className="flex-1 overflow-y-auto">
					{listing?.parent && (
						<button
							className="w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-[#111111] transition-colors hover:bg-[#111111]"
							onClick={() => navigate(listing.parent!)}
						>
							<ArrowLeft size={13} className="text-[#5f6672] shrink-0" />
							<span className="text-[12px] text-[#5f6672] font-mono">..</span>
						</button>
					)}

					{loading && <div className="px-5 py-8 text-center text-[12px] text-[#5f6672]">Loading…</div>}

					{!loading && listing?.dirs.length === 0 && (
						<div className="px-5 py-8 text-center text-[12px] text-[#5f6672]">No subdirectories</div>
					)}

					{!loading &&
						listing?.dirs.map((dir) => {
							const isSelected = selected === dir.path;
							return (
								<div
									key={dir.path}
									className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[#111111] transition-colors cursor-pointer"
									style={{ background: isSelected ? "#ffffff12" : "transparent" }}
									onClick={() => handleRowClick(dir.path)}
									onMouseEnter={(e) => {
										if (!isSelected) e.currentTarget.style.background = "#111111";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = isSelected ? "#ffffff12" : "transparent";
									}}
								>
									<Folder
										size={13}
										className={classNames("shrink-0", isSelected ? "text-[#ffffff]" : "text-[#5f6672]")}
									/>
									<span
										className={classNames(
											"flex-1 truncate text-[13px]",
											isSelected ? "text-[#ededed]" : "text-[#ededed]",
										)}
									>
										{dir.name}
									</span>
									<button
										onClick={(e) => {
											e.stopPropagation();
											navigate(dir.path);
										}}
										className="hover:opacity-70 transition-opacity shrink-0 p-1"
										title="Open folder"
									>
										<ChevronRight size={13} className={isSelected ? "text-[#ffffff]" : "text-[#3a3a3a]"} />
									</button>
								</div>
							);
						})}
				</div>

				{/* Footer */}
				<div className="flex items-center shrink-0 gap-2 px-5 py-3 border-t border-[#2a2a2a]">
					<span className="flex-1 text-[11px] truncate text-[#5f6672] font-mono">
						{selected ?? listing?.current ?? ""}
					</span>
					<button
						onClick={onClose}
						className="hover:opacity-80 transition-opacity shrink-0 px-4 py-2 border border-[#2a2a2a] rounded-md"
					>
						<span className="text-[13px] text-[#8a8f98]">Cancel</span>
					</button>
					<button
						onClick={handleConfirm}
						disabled={!listing}
						className="hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0 px-4 py-2 bg-[#ffffff] rounded-md"
					>
						<span className="text-[13px] font-medium text-[#050505]">{selected ? "Select" : "Select current"}</span>
					</button>
				</div>
			</div>
		</div>
	);
}
