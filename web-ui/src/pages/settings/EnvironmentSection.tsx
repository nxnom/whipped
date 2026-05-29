import { Button, RHFCheckbox, RHFInput, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeWorktreeSetup } from "@runtime-contract";
import { type EnvironmentForm, type EnvironmentFormInput, environmentFormSchema } from "@runtime-validation/config";
import { Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useRead } from "@/runtime/api-client";
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
	const [manualInput, setManualInput] = useState("");

	const {
		data: rootFilesData,
		loading: loadingFiles,
		error: filesError,
		trigger: fetchFiles,
	} = useRead((api) => api("workspace/root-files").GET({ query: { workspaceId } }));

	useEffect(() => {
		if (filesError) toast.error("Failed to list repo files");
	}, [filesError]);

	const methods = useForm<EnvironmentFormInput, unknown, EnvironmentForm>({
		resolver: zodResolver(environmentFormSchema),
		values: { ...setup, startCommand },
	});
	const { control, setValue } = methods;

	// Mirror RHF state back into the parent-owned config on every change so the
	// existing onChange / onStartCommandChange contract is preserved.
	const filesToCopy = useWatch({ control, name: "filesToCopy" }) ?? [];
	const installCommand = useWatch({ control, name: "installCommand" }) ?? "";

	const propagateSetup = (next: { filesToCopy: string[]; installCommand: string }) => {
		onChange({ ...setup, ...next });
	};

	const rootFiles = rootFilesData?.files ?? null;
	const discoveredSet = new Set(rootFiles ?? []);
	const allFiles = [...new Set([...(rootFiles ?? []), ...filesToCopy])].sort();
	const manualOnly = filesToCopy.filter((f) => !discoveredSet.has(f));

	const addManual = () => {
		const val = manualInput.trim();
		if (!val) return;
		const next = [...new Set([...filesToCopy, val])];
		setValue("filesToCopy", next, { shouldDirty: true });
		propagateSetup({ filesToCopy: next, installCommand });
		setManualInput("");
	};

	const removeFile = (file: string) => {
		const next = filesToCopy.filter((f) => f !== file);
		setValue("filesToCopy", next, { shouldDirty: true });
		propagateSetup({ filesToCopy: next, installCommand });
	};

	return (
		<FormProvider {...methods}>
			<SectionHeader
				title="Environment"
				description="Configure how each new worktree is set up before the agent starts. Runs once per task on first creation."
			/>

			{/* Files to copy */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className="text-xs font-medium text-gray-300">Files to Copy</p>
					<button
						onClick={() => fetchFiles()}
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
							const isManual = manualOnly.includes(file);
							return (
								<label
									key={file}
									className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/50 cursor-pointer border-b border-gray-800 last:border-0 transition-colors"
								>
									<RHFCheckbox
										name="filesToCopy"
										value={file}
										onChange={(next) =>
											propagateSetup({ filesToCopy: (next as string[] | undefined) ?? [], installCommand })
										}
									/>
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
					<input
						value={manualInput}
						onChange={(e) => setManualInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addManual()}
						placeholder="Add path manually (e.g. .env.local)"
						className="flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px] text-[#c0c0d0] font-mono text-xs outline-none"
					/>
					<Button variant="outlined" size="sm" onClick={addManual} disabled={!manualInput.trim()}>
						<Plus size={12} className="mr-1" />
						Add
					</Button>
				</div>
			</div>

			{/* Install command */}
			<Field label="Install Command">
				<RHFInput
					name="installCommand"
					placeholder="pnpm install --frozen-lockfile"
					inputClassName="font-mono text-xs"
					onChange={(v) => propagateSetup({ filesToCopy, installCommand: v ?? "" })}
				/>
				<p className="text-xs text-gray-500 mt-1">
					Runs in the worktree directory. Use{" "}
					<code className="text-gray-400 bg-gray-800 px-1 py-0.5 rounded">$REPO_PATH</code> to reference the main repo.
				</p>
			</Field>

			{/* Start command */}
			<Field label="Start Command">
				<RHFInput
					name="startCommand"
					placeholder="pnpm dev"
					inputClassName="font-mono text-xs"
					onChange={(v) => onStartCommandChange(v ?? "")}
				/>
				<p className="text-xs text-gray-500 mt-1">
					Command to run when you press ▶ on a ticket. Runs in the ticket's worktree (or repo root if no worktree exists
					yet).
				</p>
			</Field>

			<SaveRow saving={saving} onSave={onSave} />
		</FormProvider>
	);
}
