import { toast } from "@geckoui/geckoui";
import type { RuntimeWorktreeCopyEntry } from "@runtime-contract";
import { Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRead } from "@/runtime/api-client";
import { CustomCheckbox } from "./CustomCheckbox";

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
		<div className="flex flex-col gap-1.5 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2 flex-1">
			{rootFiles === null && <span className="text-[11px] py-1 text-[#4a4a5a]">Scanning...</span>}

			{rootFiles !== null && allFiles.length === 0 && (
				<span className="text-[11px] py-1 text-[#4a4a5a]">No gitignored files found in repo root</span>
			)}

			{allFiles.map((file) => {
				const entry = byPath.get(file);
				const checked = !!entry;
				const isManual = !discoveredSet.has(file);
				return (
					<label key={file} className="flex items-center gap-2 cursor-pointer group">
						<CustomCheckbox checked={checked} onChange={(v) => toggle(file, v)} />
						<span className="flex-1 text-[12px] font-mono text-[#c0c0d0]">{file}</span>
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
								className={`flex items-center gap-1 text-[10px] font-mono px-1 py-0.5 rounded transition-opacity ${
									entry.symlink ? "text-[#7aa2f7]" : "text-[#60607a] opacity-0 group-hover:opacity-100"
								}`}
							>
								<Link2 size={11} />
								{entry.symlink ? "link" : "copy"}
							</button>
						)}
						{isManual && (
							<button
								type="button"
								onClick={(e) => {
									e.preventDefault();
									onChange(filesToCopy.filter((f) => f.path !== file));
								}}
								className="opacity-0 group-hover:opacity-100 transition-opacity text-[#60607a]"
							>
								<X size={11} />
							</button>
						)}
					</label>
				);
			})}

			{/* Add file row */}
			<div className="flex items-center gap-2 pt-1">
				<div className="shrink-0 w-4 h-4 border border-[#2a2a35] rounded-[3px]" />
				<input
					value={addInput}
					onChange={(e) => setAddInput(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && addManual()}
					placeholder="Add file path..."
					className="flex-1 bg-transparent text-[12px] font-mono focus:outline-none placeholder-[#60607a] text-[#c0c0d0]"
				/>
			</div>
		</div>
	);
}
