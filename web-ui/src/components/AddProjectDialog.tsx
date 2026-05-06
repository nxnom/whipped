import { Button, Input, Switch, toast } from "@geckoui/geckoui";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { AlertCircle, CheckCircle2, ChevronLeft, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";
import { FolderPickerDialog } from "./FolderPickerDialog";

interface Props {
	onClose: () => void;
	onAdded: (workspaceId: string) => void;
}

type Step = "select" | "configure";
type PathStatus = "idle" | "checking" | "valid" | "invalid";

export function AddProjectDialog({ onClose, onAdded }: Props) {
	const [step, setStep] = useState<Step>("select");
	const [repoPath, setRepoPath] = useState("");
	const [pathStatus, setPathStatus] = useState<PathStatus>("idle");
	const [pathError, setPathError] = useState<string | null>(null);
	const [showPicker, setShowPicker] = useState(false);
	const [adding, setAdding] = useState(false);

	const [autoMode, setAutoMode] = useState(false);
	const [autoPR, setAutoPR] = useState(false);
	const [installCommand, setInstallCommand] = useState("");

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!repoPath.trim()) { setPathStatus("idle"); setPathError(null); return; }
		setPathStatus("checking");
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			try {
				const result = await trpc.projects.checkPath.query({ repoPath: repoPath.trim() });
				setPathStatus(result.valid ? "valid" : "invalid");
				setPathError(result.error);
			} catch {
				setPathStatus("invalid");
				setPathError("Failed to check path");
			}
		}, 400);
	}, [repoPath]);

	const handleAdd = async () => {
		setAdding(true);
		try {
			const initialConfig: Partial<RuntimeProjectConfig> = {
				autonomousModeEnabled: autoMode,
				autoPR,
				worktreeSetup: installCommand.trim() ? { filesToCopy: [], installCommand: installCommand.trim() } : undefined,
			};
			const result = await trpc.projects.add.mutate({ repoPath: repoPath.trim(), initialConfig });
			onAdded(result.workspaceId);
			toast.success("Project added");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to add project";
			toast.error(msg);
		} finally {
			setAdding(false);
		}
	};

	return (
		<>
			<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
				<div
					className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg overflow-hidden"
					onClick={(e) => e.stopPropagation()}
				>
					{step === "select" ? (
						<SelectStep
							repoPath={repoPath}
							pathStatus={pathStatus}
							pathError={pathError}
							onPathChange={setRepoPath}
							onBrowse={() => setShowPicker(true)}
							onNext={() => setStep("configure")}
							onClose={onClose}
						/>
					) : (
						<ConfigureStep
							repoPath={repoPath}
							autoMode={autoMode}
							autoPR={autoPR}
							installCommand={installCommand}
							adding={adding}
							onAutoMode={setAutoMode}
							onAutoPR={setAutoPR}
							onInstallCommand={setInstallCommand}
							onBack={() => setStep("select")}
							onAdd={handleAdd}
						/>
					)}
				</div>
			</div>

			{showPicker && (
				<FolderPickerDialog
					initialPath={repoPath || undefined}
					onSelect={(path) => { setRepoPath(path); setShowPicker(false); }}
					onClose={() => setShowPicker(false)}
				/>
			)}
		</>
	);
}

function SelectStep({
	repoPath, pathStatus, pathError, onPathChange, onBrowse, onNext, onClose,
}: {
	repoPath: string;
	pathStatus: PathStatus;
	pathError: string | null;
	onPathChange: (v: string) => void;
	onBrowse: () => void;
	onNext: () => void;
	onClose: () => void;
}) {
	return (
		<div className="p-5">
			<h3 className="text-base font-semibold text-gray-100 mb-1">Add Project</h3>
			<p className="text-xs text-gray-500 mb-4">Select a git repository to manage with Kanbom.</p>

			<div className="mb-1">
				<label className="text-xs text-gray-400 block mb-1">Repository path</label>
				<div className="flex gap-2">
					<Input
						value={repoPath}
						onChange={(e) => onPathChange(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && pathStatus === "valid" && onNext()}
						placeholder="/Users/you/projects/my-app"
						className="flex-1"
					/>
					<Button variant="outlined" size="sm" onClick={onBrowse} title="Browse folders">
						<FolderOpen size={14} />
					</Button>
				</div>
			</div>

			<div className="h-5 flex items-center gap-1.5 mb-4">
				{pathStatus === "checking" && <><Loader2 size={12} className="text-gray-500 animate-spin" /><span className="text-xs text-gray-500">Checking...</span></>}
				{pathStatus === "valid" && <><CheckCircle2 size={12} className="text-green-400" /><span className="text-xs text-green-400">Valid git repository</span></>}
				{pathStatus === "invalid" && <><AlertCircle size={12} className="text-red-400" /><span className="text-xs text-red-400">{pathError ?? "Invalid path"}</span></>}
			</div>

			<div className="flex gap-2 justify-end">
				<Button variant="ghost" onClick={onClose}>Cancel</Button>
				<Button onClick={onNext} disabled={pathStatus !== "valid"}>Next</Button>
			</div>
		</div>
	);
}

function ConfigureStep({
	repoPath, autoMode, autoPR, installCommand, adding,
	onAutoMode, onAutoPR, onInstallCommand, onBack, onAdd,
}: {
	repoPath: string;
	autoMode: boolean;
	autoPR: boolean;
	installCommand: string;
	adding: boolean;
	onAutoMode: (v: boolean) => void;
	onAutoPR: (v: boolean) => void;
	onInstallCommand: (v: string) => void;
	onBack: () => void;
	onAdd: () => void;
}) {
	const folderName = repoPath.split("/").filter(Boolean).at(-1) ?? repoPath;

	return (
		<div className="p-5 space-y-5">
			<div>
				<h3 className="text-base font-semibold text-gray-100">Configure <span className="text-blue-400">{folderName}</span></h3>
				<p className="text-xs text-gray-500 mt-0.5">{repoPath}</p>
			</div>

			{/* Automation */}
			<div className="space-y-3">
				<p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Automation</p>
				<label className="flex items-center justify-between cursor-pointer">
					<div>
						<p className="text-sm text-gray-200">Autonomous mode</p>
						<p className="text-xs text-gray-500">Auto-pick and run tasks marked as Ready</p>
					</div>
					<Switch checked={autoMode} onChange={onAutoMode} />
				</label>
				<label className="flex items-center justify-between cursor-pointer">
					<div>
						<p className="text-sm text-gray-200">Auto PR</p>
						<p className="text-xs text-gray-500">Create a GitHub PR when all reviews pass</p>
					</div>
					<Switch checked={autoPR} onChange={onAutoPR} />
				</label>
			</div>

			{/* Setup */}
			<div className="space-y-2">
				<p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Worktree setup <span className="text-gray-600 normal-case font-normal">(optional)</span></p>
				<div>
					<label className="text-xs text-gray-500 block mb-1">Install command</label>
					<Input
						value={installCommand}
						onChange={(e) => onInstallCommand(e.target.value)}
						placeholder="pnpm install"
					/>
					<p className="text-xs text-gray-600 mt-1">Runs once when a new worktree is created for a task.</p>
				</div>
			</div>

			<p className="text-xs text-gray-600">Workflows and agent models can be configured in Settings after adding.</p>

			<div className="flex gap-2 justify-between pt-1">
				<Button variant="ghost" size="sm" onClick={onBack}>
					<ChevronLeft size={14} className="mr-1" /> Back
				</Button>
				<Button onClick={onAdd} disabled={adding}>
					{adding ? "Adding..." : "Add Project"}
				</Button>
			</div>
		</div>
	);
}
