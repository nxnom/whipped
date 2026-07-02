import { ArrowLeft, ChevronRight, File, Folder, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useRead } from "@/runtime/api-client";
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
	const [path, setPath] = useState(initialPath ?? "");
	const [selectedFile, setSelectedFile] = useState<string | null>(null);

	// Declarative read keyed on `path` — refetches automatically as you navigate.
	const { data, fetching: loading } = useRead((api) =>
		api("fs/list-dir").GET({ query: { path, includeFiles: "true", showHidden: "true" } }),
	);
	const listing: DirListing | null = data ? { ...data, files: data.files ?? [] } : null;

	const navigate = (next: string) => {
		setSelectedFile(null);
		setPath(next);
	};

	return createPortal(
		<div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/70" onClick={onClose}>
			<div
				className="flex flex-col overflow-hidden w-[520px] max-h-[70vh] bg-whip-surface border border-whip-border rounded-xl shadow-[0_8px_40px_4px_#00000060]"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center shrink-0 gap-2.5 px-5 py-4 border-b border-whip-border">
					<FolderOpen size={15} className="text-whip-accent shrink-0" />
					<span className="flex-1 truncate text-[12px] text-whip-text font-mono">{listing?.current ?? "…"}</span>
					<button onClick={onClose} className="hover:opacity-70 transition-opacity">
						<X size={15} className="text-whip-faint" />
					</button>
				</div>

				{/* Entry list */}
				<div className="flex-1 overflow-y-auto">
					{listing?.parent && (
						<button
							className="w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-whip-border-soft transition-colors hover:bg-whip-panel"
							onClick={() => navigate(listing.parent!)}
						>
							<ArrowLeft size={13} className="text-whip-faint shrink-0" />
							<span className="text-[12px] text-whip-faint font-mono">..</span>
						</button>
					)}

					{loading && <div className="px-5 py-8 text-center text-[12px] text-whip-faint">Loading…</div>}

					{!loading &&
						listing?.dirs.map((dir) => (
							<button
								key={dir.path}
								className="w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-whip-border-soft transition-colors hover:bg-whip-panel"
								onClick={() => navigate(dir.path)}
							>
								<Folder size={13} className="text-whip-faint shrink-0" />
								<span className="flex-1 truncate text-[13px] text-whip-text">{dir.name}</span>
								<ChevronRight size={13} className="text-whip-faint shrink-0" />
							</button>
						))}

					{!loading &&
						listing?.files.map((file) => {
							const isSelected = selectedFile === file.path;
							return (
								<button
									key={file.path}
									className={classNames(
										"w-full flex items-center text-left gap-2.5 px-5 py-2.5 border-b border-whip-border-soft transition-colors",
										isSelected ? "bg-whip-accent/[7%]" : "hover:bg-whip-panel",
									)}
									onClick={() => setSelectedFile(file.path)}
									onDoubleClick={() => onSelect(file.path)}
								>
									<File
										size={13}
										className={classNames("shrink-0", isSelected ? "text-whip-accent" : "text-whip-faint")}
									/>
									<span
										className={classNames(
											"flex-1 truncate text-[13px]",
											isSelected ? "text-whip-text" : "text-whip-muted",
										)}
									>
										{file.name}
									</span>
								</button>
							);
						})}

					{!loading && listing && listing.dirs.length === 0 && listing.files.length === 0 && (
						<div className="px-5 py-8 text-center text-[12px] text-whip-faint">Empty folder</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center shrink-0 gap-2 px-5 py-3 border-t border-whip-border">
					<span className="flex-1 text-[11px] truncate text-whip-faint font-mono">{selectedFile ?? ""}</span>
					<button
						onClick={onClose}
						className="hover:opacity-80 transition-opacity shrink-0 px-4 py-2 border border-whip-border rounded-md"
					>
						<span className="text-[13px] text-whip-muted">Cancel</span>
					</button>
					<button
						onClick={() => selectedFile && onSelect(selectedFile)}
						disabled={!selectedFile}
						className="hover:opacity-80 transition-opacity disabled:opacity-40 shrink-0 px-4 py-2 bg-whip-accent rounded-md"
					>
						<span className="text-[13px] font-medium text-whip-accent-text">Select file</span>
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
