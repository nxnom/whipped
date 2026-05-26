import { Button, Checkbox, Input, toast } from "@geckoui/geckoui";
import type { RuntimeWorktreeSetup } from "@runtime-contract";
import { Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { Field, SaveRow, SectionHeader } from "./_shared";

export function EnvironmentSection({
	workspaceId,
	setup,
	onChange,
	startCommand,
	onStartCommandChange,
	onSave,
	saving,
}: {
	workspaceId: string;
	setup: RuntimeWorktreeSetup;
	onChange: (setup: RuntimeWorktreeSetup) => void;
	startCommand: string;
	onStartCommandChange: (cmd: string) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const [rootFiles, setRootFiles] = useState<string[] | null>(null);
	const [loadingFiles, setLoadingFiles] = useState(false);
	const [manualInput, setManualInput] = useState("");

	const fetchFiles = async () => {
		setLoadingFiles(true);
		try {
			const { files } = await trpc.workspace.listRootFiles.query({ workspaceId });
			setRootFiles(files);
		} catch {
			toast.error("Failed to list repo files");
		} finally {
			setLoadingFiles(false);
		}
	};

	useEffect(() => {
		fetchFiles();
	}, [workspaceId]);

	const toggleFile = (file: string, checked: boolean) => {
		const next = checked ? [...new Set([...setup.filesToCopy, file])] : setup.filesToCopy.filter((f) => f !== file);
		onChange({ ...setup, filesToCopy: next });
	};

	const addManual = () => {
		const val = manualInput.trim();
		if (!val) return;
		onChange({ ...setup, filesToCopy: [...new Set([...setup.filesToCopy, val])] });
		setManualInput("");
	};

	const removeFile = (file: string) => {
		onChange({ ...setup, filesToCopy: setup.filesToCopy.filter((f) => f !== file) });
	};

	const discoveredSet = new Set(rootFiles ?? []);
	const allFiles = [...new Set([...(rootFiles ?? []), ...setup.filesToCopy])].sort();
	const manualOnly = setup.filesToCopy.filter((f) => !discoveredSet.has(f));

	return (
		<>
			<SectionHeader
				title="Environment"
				description="Configure how each new worktree is set up before the agent starts. Runs once per task on first creation."
			/>

			{/* Files to copy */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className="text-xs font-medium text-gray-300">Files to Copy</p>
					<button
						onClick={fetchFiles}
						disabled={loadingFiles}
						className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
					>
						<RefreshCw size={11} className={loadingFiles ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>
				<p className="text-xs text-gray-500">
					Gitignored files found in the repo root. Selected files are copied into each new worktree before the agent
					runs.
				</p>

				<div className="border border-gray-800 rounded-xl overflow-hidden">
					{loadingFiles && <div className="px-4 py-6 text-center text-xs text-gray-500">Scanning repo...</div>}

					{!loadingFiles && allFiles.length === 0 && (
						<div className="px-4 py-6 text-center text-xs text-gray-500">No gitignored files found in repo root</div>
					)}

					{!loadingFiles &&
						allFiles.map((file) => {
							const isChecked = setup.filesToCopy.includes(file);
							const isManual = manualOnly.includes(file);
							return (
								<label
									key={file}
									className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800 last:border-0 transition-colors"
								>
									<Checkbox checked={isChecked} onChange={(e) => toggleFile(file, e.target.checked)} />
									<span className="flex-1 text-xs font-mono text-gray-200">{file}</span>
									{isManual && (
										<span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">manual</span>
									)}
									{isManual && (
										<button
											onClick={(e) => {
												e.preventDefault();
												removeFile(file);
											}}
											className="text-gray-600 hover:text-red-400 transition-colors"
										>
											<X size={11} />
										</button>
									)}
								</label>
							);
						})}
				</div>

				{/* Manual path input */}
				<div className="flex gap-2">
					<Input
						value={manualInput}
						onChange={(e) => setManualInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addManual()}
						placeholder="Add path manually (e.g. .env.local)"
						inputClassName="font-mono text-xs"
					/>
					<Button variant="outlined" size="sm" onClick={addManual} disabled={!manualInput.trim()}>
						<Plus size={12} className="mr-1" />
						Add
					</Button>
				</div>
			</div>

			{/* Install command */}
			<Field label="Install Command">
				<Input
					value={setup.installCommand}
					onChange={(e) => onChange({ ...setup, installCommand: e.target.value })}
					placeholder="pnpm install --frozen-lockfile"
					inputClassName="font-mono text-xs"
				/>
				<p className="text-xs text-gray-500 mt-1">
					Runs in the worktree directory. Use{" "}
					<code className="text-gray-400 bg-gray-800 px-1 py-0.5 rounded">$REPO_PATH</code> to reference the main repo.
				</p>
			</Field>

			{/* Start command */}
			<Field label="Start Command">
				<Input
					value={startCommand}
					onChange={(e) => onStartCommandChange(e.target.value)}
					placeholder="pnpm dev"
					inputClassName="font-mono text-xs"
				/>
				<p className="text-xs text-gray-500 mt-1">
					Command to run when you press ▶ on a ticket. Runs in the ticket's worktree (or repo root if no worktree
					exists yet).
				</p>
			</Field>

			<SaveRow saving={saving} onSave={onSave} />
		</>
	);
}
