import { ArrowLeft, ChevronRight, File, Folder, FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
	files: Array<{ name: string; path: string }>;
}

export function FilePickerDialog({ initialPath, onSelect, onClose }: Props) {
	const [listing, setListing] = useState<DirListing | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);

	const navigate = async (path: string) => {
		setLoading(true);
		setSelectedFile(null);
		try {
			const result = await trpc.fs.listDir.query({ path, includeFiles: true, showHidden: true });
			setListing({ ...result, files: result.files ?? [] });
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		navigate(initialPath ?? "");
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return createPortal(
		<div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70" onClick={onClose}>
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

				{/* Entry list */}
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

					{!loading &&
						listing?.dirs.map((dir) => (
							<button
								key={dir.path}
								className="w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-[#1a1a1f] transition-colors hover:bg-[#1a1a1f]"
								onClick={() => navigate(dir.path)}
							>
								<Folder size={13} className="text-[#60607a] shrink-0" />
								<span className="flex-1 truncate text-[13px] text-[#c0c0d0]">{dir.name}</span>
								<ChevronRight size={13} className="text-[#3a3a45] shrink-0" />
							</button>
						))}

					{!loading &&
						listing?.files.map((file) => {
							const isSelected = selectedFile === file.path;
							return (
								<button
									key={file.path}
									className={classNames(
										"w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-[#1a1a1f] transition-colors",
										isSelected ? "bg-[#7c6aff12]" : "hover:bg-[#1a1a1f]",
									)}
									onClick={() => setSelectedFile(file.path)}
									onDoubleClick={() => onSelect(file.path)}
								>
									<File
										size={13}
										className={classNames("shrink-0", isSelected ? "text-[#7c6aff]" : "text-[#4a4a5a]")}
									/>
									<span
										className={classNames(
											"flex-1 truncate text-[13px]",
											isSelected ? "text-[#f0f0f5]" : "text-[#8888a0]",
										)}
									>
										{file.name}
									</span>
								</button>
							);
						})}

					{!loading && listing && listing.dirs.length === 0 && listing.files.length === 0 && (
						<div className="px-5 py-8 text-center text-[12px] text-[#4a4a5a]">Empty folder</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center shrink-0 gap-2 px-5 py-3 border-t border-[#2a2a35]">
					<span className="flex-1 text-[11px] truncate text-[#4a4a5a] font-mono">{selectedFile ?? ""}</span>
					<button
						onClick={onClose}
						className="hover:opacity-80 transition-opacity shrink-0 px-4 py-2 border border-[#2a2a35] rounded-md"
					>
						<span className="text-[13px] text-[#8888a0]">Cancel</span>
					</button>
					<button
						onClick={() => selectedFile && onSelect(selectedFile)}
						disabled={!selectedFile}
						className="hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0 px-4 py-2 bg-[#7c6aff] rounded-md"
					>
						<span className="text-[13px] font-medium text-white">Select file</span>
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
