import { ArrowLeft, ChevronRight, Folder, FolderOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { classNames } from "@/utils/classNames";

interface Props {
	initialPath?: string;
	onSelect: (path: string) => void;
	onClose: () => void;
}

interface DirListing {
	current: string;
	parent: string | null;
	dirs: Array<{ name: string; path: string }>;
}

export function FolderPickerDialog({ initialPath, onSelect, onClose }: Props) {
	const [listing, setListing] = useState<DirListing | null>(null);
	const [loading, setLoading] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const navigate = async (path: string) => {
		setLoading(true);
		setSelected(null);
		try {
			const result = await trpc.fs.listDir.query({ path });
			setListing(result);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		navigate(initialPath ?? "");
	}, []);

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
				className="flex flex-col overflow-hidden w-[520px] max-h-[70vh] bg-[#141418] border border-[#2a2a35] rounded-xl shadow-[0_8px_40px_4px_#00000060]"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center shrink-0 gap-2.5 px-5 py-4 border-b border-[#2a2a35]">
					<FolderOpen size={15} className="text-[#7c6aff] shrink-0" />
					<span className="flex-1 truncate text-[12px] text-[#c0c0d0] font-mono">{listing?.current ?? "…"}</span>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={15} className="text-[#60607a]" />
					</button>
				</div>

				{/* Directory list */}
				<div className="flex-1 overflow-y-auto">
					{listing?.parent && (
						<button
							className="w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-[#1a1a1f] transition-colors hover:bg-[#1a1a1f]"
							onClick={() => navigate(listing.parent!)}
						>
							<ArrowLeft size={13} className="text-[#60607a] shrink-0" />
							<span className="text-[12px] text-[#60607a] font-mono">..</span>
						</button>
					)}

					{loading && <div className="px-5 py-8 text-center text-[12px] text-[#4a4a5a]">Loading…</div>}

					{!loading && listing?.dirs.length === 0 && (
						<div className="px-5 py-8 text-center text-[12px] text-[#4a4a5a]">No subdirectories</div>
					)}

					{!loading &&
						listing?.dirs.map((dir) => {
							const isSelected = selected === dir.path;
							return (
								<div
									key={dir.path}
									className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[#1a1a1f] transition-colors cursor-pointer"
									style={{ background: isSelected ? "#7c6aff12" : "transparent" }}
									onClick={() => handleRowClick(dir.path)}
									onMouseEnter={(e) => {
										if (!isSelected) e.currentTarget.style.background = "#1a1a1f";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = isSelected ? "#7c6aff12" : "transparent";
									}}
								>
									<Folder
										size={13}
										className={classNames("shrink-0", isSelected ? "text-[#7c6aff]" : "text-[#60607a]")}
									/>
									<span
										className={classNames(
											"flex-1 truncate text-[13px]",
											isSelected ? "text-[#f0f0f5]" : "text-[#c0c0d0]",
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
										<ChevronRight size={13} className={isSelected ? "text-[#7c6aff]" : "text-[#3a3a45]"} />
									</button>
								</div>
							);
						})}
				</div>

				{/* Footer */}
				<div className="flex items-center shrink-0 gap-2 px-5 py-3 border-t border-[#2a2a35]">
					<span className="flex-1 text-[11px] truncate text-[#4a4a5a] font-mono">
						{selected ?? listing?.current ?? ""}
					</span>
					<button
						onClick={onClose}
						className="hover:opacity-80 transition-opacity shrink-0 px-4 py-2 border border-[#2a2a35] rounded-md"
					>
						<span className="text-[13px] text-[#8888a0]">Cancel</span>
					</button>
					<button
						onClick={handleConfirm}
						disabled={!listing}
						className="hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0 px-4 py-2 bg-[#7c6aff] rounded-md"
					>
						<span className="text-[13px] font-medium text-white">{selected ? "Select" : "Select current"}</span>
					</button>
				</div>
			</div>
		</div>
	);
}
