import { toast } from "@geckoui/geckoui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRead } from "@/runtime/api-client";
import { CustomCheckbox } from "./CustomCheckbox";

export function FilesBox({
	workspaceId,
	filesToCopy,
	onChange,
}: {
	workspaceId: string;
	filesToCopy: string[];
	onChange: (files: string[]) => void;
}) {
	const [addInput, setAddInput] = useState("");

	const { data, error: filesError } = useRead((api) => api("workspace/root-files").GET({ query: { workspaceId } }));

	useEffect(() => {
		if (filesError) toast.error("Failed to list repo files");
	}, [filesError]);

	const rootFiles = data?.files ?? null;
	const discoveredSet = new Set(rootFiles ?? []);
	const allFiles = [...new Set([...(rootFiles ?? []), ...filesToCopy])].sort();

	const toggle = (file: string, checked: boolean) => {
		onChange(checked ? [...new Set([...filesToCopy, file])] : filesToCopy.filter((f) => f !== file));
	};

	const addManual = () => {
		const val = addInput.trim();
		if (!val) return;
		onChange([...new Set([...filesToCopy, val])]);
		setAddInput("");
	};

	return (
		<div className="flex flex-col gap-1.5 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2 flex-1">
			{rootFiles === null && <span className="text-[11px] py-1 text-[#4a4a5a]">Scanning...</span>}

			{rootFiles !== null && allFiles.length === 0 && (
				<span className="text-[11px] py-1 text-[#4a4a5a]">No gitignored files found in repo root</span>
			)}

			{allFiles.map((file) => {
				const checked = filesToCopy.includes(file);
				const isManual = !discoveredSet.has(file);
				return (
					<label key={file} className="flex items-center gap-2 cursor-pointer group">
						<CustomCheckbox checked={checked} onChange={(v) => toggle(file, v)} />
						<span className="flex-1 text-[12px] font-mono text-[#c0c0d0]">{file}</span>
						{isManual && (
							<button
								onClick={(e) => {
									e.preventDefault();
									onChange(filesToCopy.filter((f) => f !== file));
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
