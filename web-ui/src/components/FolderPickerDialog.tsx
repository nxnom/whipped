import { ArrowLeft, ChevronRight, Folder, FolderOpen, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

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
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center"
			style={{ background: "rgba(0,0,0,0.7)" }}
			onClick={onClose}
		>
			<div
				className="flex flex-col overflow-hidden"
				style={{
					width: 520,
					maxHeight: "70vh",
					background: "#141418",
					border: "1px solid #2a2a35",
					borderRadius: 12,
					boxShadow: "0 8px 40px 4px #00000060",
				}}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div
					className="flex items-center shrink-0"
					style={{ gap: 10, padding: "16px 20px", borderBottom: "1px solid #2a2a35" }}
				>
					<FolderOpen size={15} style={{ color: "#7c6aff", flexShrink: 0 }} />
					<span
						className="flex-1 truncate text-[12px]"
						style={{ color: "#c0c0d0", fontFamily: "JetBrains Mono, monospace" }}
					>
						{listing?.current ?? "…"}
					</span>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={15} style={{ color: "#60607a" }} />
					</button>
				</div>

				{/* Directory list */}
				<div className="flex-1 overflow-y-auto">
					{listing?.parent && (
						<button
							className="w-full flex items-center text-left transition-colors hover:bg-[#1a1a1f]"
							style={{ gap: 10, padding: "10px 20px", borderBottom: "1px solid #1a1a1f" }}
							onClick={() => navigate(listing.parent!)}
						>
							<ArrowLeft size={13} style={{ color: "#60607a", flexShrink: 0 }} />
							<span className="text-[12px]" style={{ color: "#60607a", fontFamily: "JetBrains Mono, monospace" }}>
								..
							</span>
						</button>
					)}

					{loading && (
						<div className="px-5 py-8 text-center text-[12px]" style={{ color: "#4a4a5a" }}>
							Loading…
						</div>
					)}

					{!loading && listing?.dirs.length === 0 && (
						<div className="px-5 py-8 text-center text-[12px]" style={{ color: "#4a4a5a" }}>
							No subdirectories
						</div>
					)}

					{!loading &&
						listing?.dirs.map((dir) => {
							const isSelected = selected === dir.path;
							return (
								<div
									key={dir.path}
									className="flex items-center transition-colors cursor-pointer"
									style={{
										gap: 10,
										padding: "10px 20px",
										borderBottom: "1px solid #1a1a1f",
										background: isSelected ? "#7c6aff12" : "transparent",
									}}
									onClick={() => handleRowClick(dir.path)}
									onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#1a1a1f"; }}
									onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? "#7c6aff12" : "transparent"; }}
								>
									<Folder size={13} style={{ color: isSelected ? "#7c6aff" : "#60607a", flexShrink: 0 }} />
									<span className="flex-1 truncate text-[13px]" style={{ color: isSelected ? "#f0f0f5" : "#c0c0d0" }}>
										{dir.name}
									</span>
									<button
										onClick={(e) => { e.stopPropagation(); navigate(dir.path); }}
										className="hover:opacity-70 transition-opacity shrink-0 p-1"
										title="Open folder"
									>
										<ChevronRight size={13} style={{ color: isSelected ? "#7c6aff" : "#3a3a45" }} />
									</button>
								</div>
							);
						})}
				</div>

				{/* Footer */}
				<div
					className="flex items-center shrink-0"
					style={{ gap: 8, padding: "12px 20px", borderTop: "1px solid #2a2a35" }}
				>
					<span className="flex-1 text-[11px] truncate" style={{ color: "#4a4a5a", fontFamily: "JetBrains Mono, monospace" }}>
						{selected ?? listing?.current ?? ""}
					</span>
					<button
						onClick={onClose}
						className="hover:opacity-80 transition-opacity shrink-0"
						style={{ padding: "8px 16px", border: "1px solid #2a2a35", borderRadius: 6 }}
					>
						<span className="text-[13px]" style={{ color: "#8888a0" }}>
							Cancel
						</span>
					</button>
					<button
						onClick={handleConfirm}
						disabled={!listing}
						className="hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0"
						style={{ padding: "8px 16px", background: "#7c6aff", borderRadius: 6 }}
					>
						<span className="text-[13px] font-medium" style={{ color: "#ffffff" }}>
							{selected ? "Select" : "Select current"}
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
