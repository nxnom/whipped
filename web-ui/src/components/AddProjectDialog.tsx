import type { RuntimeProjectConfig } from "@runtime-contract";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Folder, FolderPlus, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@geckoui/geckoui";
import { trpc } from "@/runtime/trpc-client";
import { classNames } from "@/utils/classNames";
import { FolderPickerDialog } from "./FolderPickerDialog";

interface Props {
	onClose: () => void;
	onAdded: (workspaceId: string) => void;
}

type Step = "select" | "configure";
type PathStatus = "idle" | "checking" | "valid" | "invalid";

interface RepoInfo {
	name: string | null;
	branch: string | null;
	remote: string | null;
}

export function AddProjectDialog({ onClose, onAdded }: Props) {
	const [step, setStep] = useState<Step>("select");
	const [repoPath, setRepoPath] = useState("");
	const [pathStatus, setPathStatus] = useState<PathStatus>("idle");
	const [pathError, setPathError] = useState<string | null>(null);
	const [repoInfo, setRepoInfo] = useState<RepoInfo>({ name: null, branch: null, remote: null });
	const [showPicker, setShowPicker] = useState(false);
	const [adding, setAdding] = useState(false);

	const [autoMode, setAutoMode] = useState(false);
	const [autoPR, setAutoPR] = useState(false);
	const [installCommand, setInstallCommand] = useState("");

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!repoPath.trim()) {
			setPathStatus("idle");
			setPathError(null);
			setRepoInfo({ name: null, branch: null, remote: null });
			return;
		}
		setPathStatus("checking");
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			try {
				const result = await trpc.projects.checkPath.query({ repoPath: repoPath.trim() });
				setPathStatus(result.valid ? "valid" : "invalid");
				setPathError(result.error ?? null);
				setRepoInfo({ name: result.name ?? null, branch: result.branch ?? null, remote: result.remote ?? null });
			} catch {
				setPathStatus("invalid");
				setPathError("Failed to check path");
				setRepoInfo({ name: null, branch: null, remote: null });
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
			{/* Backdrop */}
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
				{/* Dialog */}
				<div
					className="flex flex-col overflow-hidden w-[560px] h-[580px] bg-[#141418] border border-[#2a2a35] rounded-xl shadow-[0_8px_40px_4px_#00000060]"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center shrink-0 gap-3 px-6 py-[18px] border-b border-[#2a2a35]">
						<FolderPlus size={18} className="text-[#7c6aff] shrink-0" />
						<span className="text-[16px] font-semibold text-[#f0f0f5]">Add Project</span>
						<div className="flex-1" />
						<button onClick={onClose} className="hover:opacity-70 transition-opacity">
							<X size={16} className="text-[#60607a]" />
						</button>
					</div>

					{/* Step indicator */}
					<div className="flex items-center shrink-0 gap-2 px-6 py-4 border-b border-[#2a2a35]">
						{/* Step 1 */}
						<div className="flex items-center gap-2">
							<div
								className={classNames(
									"flex items-center justify-center shrink-0 w-[22px] h-[22px] rounded-full",
									step === "select" ? "bg-[#7c6aff]" : "bg-[#1a1a1f] border border-[#2a2a35]",
								)}
							>
								<span
									className={classNames("text-[11px] font-bold", step === "select" ? "text-white" : "text-[#60607a]")}
								>
									1
								</span>
							</div>
							<span
								className={classNames(
									"text-[12px]",
									step === "select" ? "text-[#f0f0f5] font-semibold" : "text-[#60607a]",
								)}
							>
								Select Repository
							</span>
						</div>

						{/* Connector */}
						<div className="w-6 h-px bg-[#2a2a35] shrink-0" />

						{/* Step 2 */}
						<div className="flex items-center gap-2">
							<div
								className={classNames(
									"flex items-center justify-center shrink-0 w-[22px] h-[22px] rounded-full",
									step === "configure" ? "bg-[#7c6aff]" : "bg-[#1a1a1f] border border-[#2a2a35]",
								)}
							>
								<span
									className={classNames(
										"text-[11px] font-semibold",
										step === "configure" ? "text-white" : "text-[#60607a]",
									)}
								>
									2
								</span>
							</div>
							<span
								className={classNames(
									"text-[12px]",
									step === "configure" ? "text-[#f0f0f5] font-semibold" : "text-[#60607a]",
								)}
							>
								Configure
							</span>
						</div>
					</div>

					{/* Body */}
					{step === "select" ? (
						<SelectStep
							repoPath={repoPath}
							pathStatus={pathStatus}
							pathError={pathError}
							repoInfo={repoInfo}
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
					onSelect={(path) => {
						setRepoPath(path);
						setShowPicker(false);
					}}
					onClose={() => setShowPicker(false)}
				/>
			)}
		</>
	);
}

function SelectStep({
	repoPath,
	pathStatus,
	pathError,
	repoInfo,
	onPathChange,
	onBrowse,
	onNext,
	onClose,
}: {
	repoPath: string;
	pathStatus: PathStatus;
	pathError: string | null;
	repoInfo: RepoInfo;
	onPathChange: (v: string) => void;
	onBrowse: () => void;
	onNext: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
				{/* Repository Path label */}
				<span className="text-[13px] font-medium shrink-0 text-[#c0c0d0]">Repository Path</span>

				{/* Path input row */}
				<div className="flex shrink-0 gap-2">
					<div className="flex items-center flex-1 min-w-0 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3.5 py-2.5 gap-2">
						<Folder size={14} className="text-[#60607a] shrink-0" />
						<input
							value={repoPath}
							onChange={(e) => onPathChange(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && pathStatus === "valid" && onNext()}
							placeholder="/Users/dev/projects/my-app"
							className="flex-1 bg-transparent outline-none min-w-0 text-[#c0c0d0] font-mono text-[12px]"
						/>
						{pathStatus === "checking" && <Loader2 size={12} className="animate-spin shrink-0 text-[#60607a]" />}
					</div>
					<button
						onClick={onBrowse}
						className="shrink-0 hover:opacity-80 transition-opacity px-3.5 py-2.5 border border-[#2a2a35] rounded-md"
					>
						<span className="text-[12px] text-[#8888a0]">Browse</span>
					</button>
				</div>

				{/* Status row */}
				<div className="flex items-center shrink-0 gap-1.5 min-h-5">
					{pathStatus === "valid" && (
						<>
							<CheckCircle2 size={14} className="text-[#22c55e] shrink-0" />
							<span className="text-[12px] text-[#22c55e]">Valid git repository</span>
						</>
					)}
					{pathStatus === "invalid" && (
						<>
							<AlertCircle size={14} className="text-[#ef4444] shrink-0" />
							<span className="text-[12px] text-[#ef4444]">{pathError ?? "Invalid path"}</span>
						</>
					)}
				</div>

				{/* Divider */}
				<div className="h-px bg-[#1a1a1f] shrink-0" />

				{/* Repo info card */}
				{pathStatus === "valid" ? (
					<div className="shrink-0 flex flex-col bg-[#0c0c0f] border border-[#2a2a35] rounded-lg px-4 py-3.5 gap-2.5">
						<InfoRow label="Name" value={repoInfo.name ?? "—"} mono={false} />
						<InfoRow label="Branch" value={repoInfo.branch ?? "—"} mono />
						<InfoRow label="Remote" value={repoInfo.remote ?? "—"} mono />
					</div>
				) : (
					<div className="shrink-0 flex flex-col bg-[#0c0c0f] border border-[#2a2a35] rounded-lg px-4 py-3.5 gap-2.5 opacity-40">
						<InfoRow label="Name" value="—" mono={false} />
						<InfoRow label="Branch" value="—" mono />
						<InfoRow label="Remote" value="—" mono />
					</div>
				)}

				{/* Spacer */}
				<div className="flex-1" />
			</div>

			{/* Pinned footer */}
			<div className="flex items-center justify-end shrink-0 gap-2 px-6 py-3 border-t border-[#2a2a35]">
				<button
					onClick={onClose}
					className="hover:opacity-80 transition-opacity px-[18px] py-[9px] border border-[#2a2a35] rounded-md"
				>
					<span className="text-[13px] text-[#8888a0]">Cancel</span>
				</button>
				<button
					onClick={onNext}
					disabled={pathStatus !== "valid"}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40 px-[18px] py-[9px] bg-[#7c6aff] rounded-md gap-1.5"
				>
					<span className="text-[13px] font-medium text-white">Next</span>
					<ArrowRight size={14} className="text-white" />
				</button>
			</div>
		</div>
	);
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
	return (
		<div className="flex items-center">
			<span className="text-[11px] shrink-0 text-[#60607a] w-20">{label}</span>
			<span
				className={classNames(
					"text-[12px] truncate",
					label === "Name" ? "text-[#f0f0f5]" : "text-[#c0c0d0]",
					mono ? "font-mono font-normal" : "font-medium",
				)}
			>
				{value}
			</span>
		</div>
	);
}

function ConfigureStep({
	repoPath,
	autoMode,
	autoPR,
	installCommand,
	adding,
	onAutoMode,
	onAutoPR,
	onInstallCommand,
	onBack,
	onAdd,
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
		<div className="flex-1 flex flex-col min-h-0">
			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
				<div>
					<span className="text-[15px] font-semibold text-[#f0f0f5]">
						Configure <span className="text-[#7c6aff]">{folderName}</span>
					</span>
					<p className="text-[12px] mt-1 text-[#60607a] font-mono">{repoPath}</p>
				</div>

				<div className="flex flex-col gap-3.5">
					<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">Automation</span>
					<ToggleRow
						label="Autonomous mode"
						description="Auto-pick and run tasks marked as Ready"
						checked={autoMode}
						onChange={onAutoMode}
					/>
					<ToggleRow
						label="Auto PR"
						description="Create a GitHub PR when all reviews pass"
						checked={autoPR}
						onChange={onAutoPR}
					/>
				</div>

				<div className="flex flex-col gap-2.5">
					<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">Worktree setup</span>
					<div>
						<span className="text-[12px] text-[#8888a0]">Install command</span>
						<input
							value={installCommand}
							onChange={(e) => onInstallCommand(e.target.value)}
							placeholder="pnpm install"
							className="mt-1.5 w-full outline-none bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2 text-[#c0c0d0] text-[12px]"
						/>
						<p className="text-[11px] mt-1 text-[#4a4a5a]">Runs once when a new worktree is created for a task.</p>
					</div>
				</div>
			</div>

			{/* Pinned footer */}
			<div className="flex items-center shrink-0 gap-2 px-6 py-3 border-t border-[#2a2a35]">
				<button
					onClick={onBack}
					className="flex items-center hover:opacity-80 transition-opacity gap-[5px] px-[18px] py-[9px] border border-[#2a2a35] rounded-md"
				>
					<ArrowLeft size={14} className="text-[#8888a0]" />
					<span className="text-[13px] text-[#8888a0]">Back</span>
				</button>
				<div className="flex-1" />
				<button
					onClick={onAdd}
					disabled={adding}
					className="hover:opacity-80 transition-opacity disabled:opacity-40 px-[18px] py-[9px] border border-[#2a2a35] rounded-md"
				>
					<span className="text-[13px] text-[#8888a0]">Skip Setup</span>
				</button>
				<button
					onClick={onAdd}
					disabled={adding}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40 gap-1.5 px-[18px] py-[9px] bg-[#7c6aff] rounded-md"
				>
					<Plus size={14} className="text-white" />
					<span className="text-[13px] font-medium text-white">{adding ? "Creating..." : "Create Project"}</span>
				</button>
			</div>
		</div>
	);
}

function ToggleRow({
	label,
	description,
	checked,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<p className="text-[13px] text-[#c0c0d0]">{label}</p>
				<p className="text-[11px] mt-0.5 text-[#4a4a5a]">{description}</p>
			</div>
			<button
				onClick={() => onChange(!checked)}
				className={classNames(
					"shrink-0 transition-colors relative w-9 h-5 rounded-[10px]",
					checked ? "bg-[#7c6aff]" : "bg-[#2a2a35]",
				)}
			>
				<div
					className={classNames(
						"absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-[left] duration-150",
						checked ? "left-[19px]" : "left-[3px]",
					)}
				/>
			</button>
		</div>
	);
}
