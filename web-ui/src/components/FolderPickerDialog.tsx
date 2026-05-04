import { Button } from "@geckoui/geckoui";
import { ArrowLeft, Check, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
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

	const navigate = async (path: string) => {
		setLoading(true);
		try {
			const result = await trpc.fs.listDir.query({ path });
			setListing(result);
			setSelected(null);
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

	return (
		<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md flex flex-col"
				style={{ maxHeight: "70vh" }}
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
					<FolderOpen size={15} className="text-blue-400 shrink-0" />
					<span className="text-xs text-gray-300 truncate flex-1 font-mono">{listing?.current ?? "…"}</span>
				</div>

				{/* Directory list */}
				<div className="flex-1 overflow-y-auto">
					{listing?.parent && (
						<button
							className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors text-sm"
							onClick={() => navigate(listing.parent!)}
						>
							<ArrowLeft size={13} />
							<span className="font-mono text-xs">..</span>
						</button>
					)}

					{loading && <div className="px-4 py-6 text-center text-xs text-gray-500">Loading…</div>}

					{!loading && listing?.dirs.length === 0 && (
						<div className="px-4 py-6 text-center text-xs text-gray-500">No subdirectories</div>
					)}

					{!loading &&
						listing?.dirs.map((dir) => {
							const isSelected = selected === dir.path;
							return (
								<button
									key={dir.path}
									className={`w-full flex items-center gap-2 px-4 py-2 transition-colors text-sm text-left ${
										isSelected ? "bg-blue-600/20 text-blue-300" : "hover:bg-gray-800 text-gray-300"
									}`}
									onClick={() => setSelected(isSelected ? null : dir.path)}
									onDoubleClick={() => navigate(dir.path)}
								>
									<Folder size={13} className={isSelected ? "text-blue-400" : "text-gray-500"} />
									<span className="flex-1 truncate text-xs font-mono">{dir.name}</span>
									{isSelected ? (
										<Check size={12} className="text-blue-400 shrink-0" />
									) : (
										<ChevronRight size={12} className="text-gray-600 shrink-0" />
									)}
								</button>
							);
						})}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-800">
					<p className="text-xs text-gray-500 truncate flex-1">
						{selected ? (
							<span className="text-gray-300 font-mono">{selected.split("/").pop()}</span>
						) : (
							<span>Single-click to select · double-click to open</span>
						)}
					</p>
					<div className="flex gap-2 shrink-0">
						<Button variant="ghost" size="sm" onClick={onClose}>
							Cancel
						</Button>
						<Button size="sm" onClick={handleConfirm} disabled={!listing}>
							{selected ? "Select" : "Select current"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
