import { Checkbox, toast } from "@geckoui/geckoui";
import type { RuntimeWorktreeCopyEntry } from "@runtime-contract";
import { Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRead } from "@/runtime/api-client";

export function FilesBox({
	workspaceId,
	filesToCopy,
	onChange,
}: {
	workspaceId: string;
	filesToCopy: RuntimeWorktreeCopyEntry[];
	onChange: (files: RuntimeWorktreeCopyEntry[]) => void;
}) {
	const [addInput, setAddInput] = useState("");

	const { data, error: filesError } = useRead((api) => api("workspace/root-files").GET({ query: { workspaceId } }));

	useEffect(() => {
		if (filesError) toast.error("Failed to list repo files");
	}, [filesError]);

	const rootFiles = data?.files ?? null;
	const discoveredSet = new Set(rootFiles ?? []);
	const byPath = new Map(filesToCopy.map((e) => [e.path, e]));
	const allFiles = [...new Set([...(rootFiles ?? []), ...filesToCopy.map((e) => e.path)])].sort();

	const toggle = (file: string, checked: boolean) => {
		if (checked) {
			if (!byPath.has(file)) onChange([...filesToCopy, { path: file, symlink: false }]);
		} else {
			onChange(filesToCopy.filter((e) => e.path !== file));
		}
	};

	const setSymlink = (file: string, symlink: boolean) => {
		onChange(filesToCopy.map((e) => (e.path === file ? { ...e, symlink } : e)));
	};

	const addManual = () => {
		const val = addInput.trim();
		if (!val) return;
		if (!byPath.has(val)) onChange([...filesToCopy, { path: val, symlink: false }]);
		setAddInput("");
	};

	return (
		<div className="flex flex-col gap-0.5 bg-whip-panel border border-whip-border rounded-md px-3 py-2 flex-1">
			{rootFiles === null && <span className="text-[11px] py-1 text-whip-faint">Scanning...</span>}

			{rootFiles !== null && allFiles.length === 0 && (
				<span className="text-[11px] py-1 text-whip-faint">No gitignored files found in repo root</span>
			)}

			{allFiles.map((file) => {
				const entry = byPath.get(file);
				const checked = !!entry;
				const isManual = !discoveredSet.has(file);
				return (
					<label
						key={file}
						className="flex items-center gap-2 cursor-pointer group -mx-2 px-2 py-1 rounded transition-colors hover:bg-whip-panel-2"
					>
						{/* Link/copy toggle in a fixed-width slot before the checkbox so rows stay aligned */}
						<span className="shrink-0 w-4 flex justify-center">
							{entry && (
								<button
									type="button"
									title={
										entry.symlink
											? "Symlinked (shared from repo). Click to copy instead."
											: "Copied into worktree. Click to symlink (share from repo, e.g. node_modules)."
									}
									onClick={(e) => {
										e.preventDefault();
										setSymlink(file, !entry.symlink);
									}}
									className={`transition-colors ${
										entry.symlink ? "text-whip-accent" : "text-whip-faint hover:text-whip-muted"
									}`}
								>
									<Link2 size={12} />
								</button>
							)}
						</span>
						<Checkbox checked={checked} onChange={(e) => toggle(file, e.target.checked)} />
						<span className="flex-1 text-[12px] font-mono text-whip-text">{file}</span>
						{isManual && (
							<button
								type="button"
								onClick={(e) => {
									e.preventDefault();
									onChange(filesToCopy.filter((f) => f.path !== file));
								}}
								className="opacity-0 group-hover:opacity-100 transition-opacity text-whip-faint"
							>
								<X size={11} />
							</button>
						)}
					</label>
				);
			})}

			{/* Add file row */}
			<div className="flex items-center gap-2 pt-1.5">
				<span className="shrink-0 w-4" />
				<div className="shrink-0 w-4 h-4 border border-whip-border rounded-[3px]" />
				<input
					value={addInput}
					onChange={(e) => setAddInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && addManual()}
					placeholder="Add file path..."
					className="flex-1 bg-transparent text-[12px] font-mono focus:outline-none placeholder-whip-faint text-whip-text"
				/>
			</div>
		</div>
	);
}
