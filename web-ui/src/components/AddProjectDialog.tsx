import type { RuntimeProjectConfig } from "@runtime-contract";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Folder, FolderPlus, Loader2, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@geckoui/geckoui";
import { trpc } from "@/runtime/trpc-client";
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
			<div
				className="fixed inset-0 z-50 flex items-center justify-center"
				style={{ background: "rgba(0,0,0,0.7)" }}
				onClick={onClose}
			>
				{/* Dialog */}
				<div
					className="flex flex-col overflow-hidden"
					style={{
						width: 560,
						height: 580,
						background: "#141418",
						border: "1px solid #2a2a35",
						borderRadius: 12,
						boxShadow: "0 8px 40px 4px #00000060",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div
						className="flex items-center shrink-0"
						style={{ gap: 12, padding: "18px 24px", borderBottom: "1px solid #2a2a35" }}
					>
						<FolderPlus size={18} style={{ color: "#7c6aff", flexShrink: 0 }} />
						<span className="text-[16px] font-semibold" style={{ color: "#f0f0f5" }}>
							Add Project
						</span>
						<div style={{ flex: 1 }} />
						<button onClick={onClose} className="hover:opacity-70 transition-opacity">
							<X size={16} style={{ color: "#60607a" }} />
						</button>
					</div>

					{/* Step indicator */}
					<div
						className="flex items-center shrink-0"
						style={{ gap: 8, padding: "16px 24px", borderBottom: "1px solid #2a2a35" }}
					>
						{/* Step 1 */}
						<div className="flex items-center" style={{ gap: 8 }}>
							<div
								className="flex items-center justify-center shrink-0"
								style={{
									width: 22,
									height: 22,
									borderRadius: 11,
									background: step === "select" ? "#7c6aff" : "#1a1a1f",
									border: step === "select" ? "none" : "1px solid #2a2a35",
								}}
							>
								<span className="text-[11px] font-bold" style={{ color: step === "select" ? "#ffffff" : "#60607a" }}>
									1
								</span>
							</div>
							<span
								className="text-[12px]"
								style={{ color: step === "select" ? "#f0f0f5" : "#60607a", fontWeight: step === "select" ? 600 : 400 }}
							>
								Select Repository
							</span>
						</div>

						{/* Connector */}
						<div style={{ width: 24, height: 1, background: "#2a2a35", flexShrink: 0 }} />

						{/* Step 2 */}
						<div className="flex items-center" style={{ gap: 8 }}>
							<div
								className="flex items-center justify-center shrink-0"
								style={{
									width: 22,
									height: 22,
									borderRadius: 11,
									background: step === "configure" ? "#7c6aff" : "#1a1a1f",
									border: step === "configure" ? "none" : "1px solid #2a2a35",
								}}
							>
								<span className="text-[11px] font-semibold" style={{ color: step === "configure" ? "#ffffff" : "#60607a" }}>
									2
								</span>
							</div>
							<span
								className="text-[12px]"
								style={{ color: step === "configure" ? "#f0f0f5" : "#60607a", fontWeight: step === "configure" ? 600 : 400 }}
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
			<div className="flex-1 overflow-y-auto" style={{ padding: 24, gap: 16, display: "flex", flexDirection: "column" }}>
			{/* Repository Path label */}
			<span className="text-[13px] font-medium shrink-0" style={{ color: "#c0c0d0" }}>
				Repository Path
			</span>

			{/* Path input row */}
			<div className="flex shrink-0" style={{ gap: 8 }}>
				<div
					className="flex items-center flex-1 min-w-0"
					style={{
						background: "#0c0c0f",
						border: "1px solid #2a2a35",
						borderRadius: 6,
						padding: "10px 14px",
						gap: 8,
					}}
				>
					<Folder size={14} style={{ color: "#60607a", flexShrink: 0 }} />
					<input
						value={repoPath}
						onChange={(e) => onPathChange(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && pathStatus === "valid" && onNext()}
						placeholder="/Users/dev/projects/my-app"
						className="flex-1 bg-transparent outline-none min-w-0"
						style={{ color: "#c0c0d0", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
					/>
					{pathStatus === "checking" && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "#60607a" }} />}
				</div>
				<button
					onClick={onBrowse}
					className="shrink-0 hover:opacity-80 transition-opacity"
					style={{ padding: "10px 14px", border: "1px solid #2a2a35", borderRadius: 6 }}
				>
					<span className="text-[12px]" style={{ color: "#8888a0" }}>
						Browse
					</span>
				</button>
			</div>

			{/* Status row */}
			<div className="flex items-center shrink-0" style={{ gap: 6, minHeight: 20 }}>
				{pathStatus === "valid" && (
					<>
						<CheckCircle2 size={14} style={{ color: "#22c55e", flexShrink: 0 }} />
						<span className="text-[12px]" style={{ color: "#22c55e" }}>
							Valid git repository
						</span>
					</>
				)}
				{pathStatus === "invalid" && (
					<>
						<AlertCircle size={14} style={{ color: "#ef4444", flexShrink: 0 }} />
						<span className="text-[12px]" style={{ color: "#ef4444" }}>
							{pathError ?? "Invalid path"}
						</span>
					</>
				)}
			</div>

			{/* Divider */}
			<div style={{ height: 1, background: "#1a1a1f", flexShrink: 0 }} />

			{/* Repo info card */}
			{pathStatus === "valid" && (
				<div
					className="shrink-0 flex flex-col"
					style={{
						background: "#0c0c0f",
						border: "1px solid #2a2a35",
						borderRadius: 8,
						padding: "14px 16px",
						gap: 10,
					}}
				>
					<InfoRow label="Name" value={repoInfo.name ?? "—"} mono={false} />
					<InfoRow label="Branch" value={repoInfo.branch ?? "—"} mono />
					<InfoRow label="Remote" value={repoInfo.remote ?? "—"} mono />
				</div>
			)}
			{pathStatus !== "valid" && (
				<div
					className="shrink-0 flex flex-col"
					style={{
						background: "#0c0c0f",
						border: "1px solid #2a2a35",
						borderRadius: 8,
						padding: "14px 16px",
						gap: 10,
						opacity: 0.4,
					}}
				>
					<InfoRow label="Name" value="—" mono={false} />
					<InfoRow label="Branch" value="—" mono />
					<InfoRow label="Remote" value="—" mono />
				</div>
			)}

			{/* Spacer */}
			<div style={{ flex: 1 }} />
			</div>

			{/* Pinned footer */}
			<div
				className="flex items-center justify-end shrink-0"
				style={{ gap: 8, padding: "12px 24px", borderTop: "1px solid #2a2a35" }}
			>
				<button
					onClick={onClose}
					className="hover:opacity-80 transition-opacity"
					style={{ padding: "9px 18px", border: "1px solid #2a2a35", borderRadius: 6 }}
				>
					<span className="text-[13px]" style={{ color: "#8888a0" }}>
						Cancel
					</span>
				</button>
				<button
					onClick={onNext}
					disabled={pathStatus !== "valid"}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40"
					style={{ padding: "9px 18px", background: "#7c6aff", borderRadius: 6, gap: 6 }}
				>
					<span className="text-[13px] font-medium" style={{ color: "#ffffff" }}>
						Next
					</span>
					<ArrowRight size={14} style={{ color: "#ffffff" }} />
				</button>
			</div>
		</div>
	);
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
	return (
		<div className="flex items-center">
			<span className="text-[11px] shrink-0" style={{ color: "#60607a", width: 80 }}>
				{label}
			</span>
			<span
				className="text-[12px] font-medium truncate"
				style={{
					color: label === "Name" ? "#f0f0f5" : "#c0c0d0",
					fontFamily: mono ? "JetBrains Mono, monospace" : undefined,
					fontWeight: mono ? 400 : 500,
				}}
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
			<div className="flex-1 overflow-y-auto" style={{ padding: 24, gap: 20, display: "flex", flexDirection: "column" }}>
				<div>
					<span className="text-[15px] font-semibold" style={{ color: "#f0f0f5" }}>
						Configure{" "}
						<span style={{ color: "#7c6aff" }}>{folderName}</span>
					</span>
					<p className="text-[12px] mt-1" style={{ color: "#60607a", fontFamily: "JetBrains Mono, monospace" }}>
						{repoPath}
					</p>
				</div>

				<div className="flex flex-col" style={{ gap: 14 }}>
					<span className="text-[10px] font-medium uppercase" style={{ color: "#4a4a5a", letterSpacing: 1 }}>
						Automation
					</span>
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

				<div className="flex flex-col" style={{ gap: 10 }}>
					<span className="text-[10px] font-medium uppercase" style={{ color: "#4a4a5a", letterSpacing: 1 }}>
						Worktree setup
					</span>
					<div>
						<span className="text-[12px]" style={{ color: "#8888a0" }}>
							Install command
						</span>
						<input
							value={installCommand}
							onChange={(e) => onInstallCommand(e.target.value)}
							placeholder="pnpm install"
							className="mt-1.5 w-full outline-none"
							style={{
								background: "#0c0c0f",
								border: "1px solid #2a2a35",
								borderRadius: 6,
								padding: "8px 12px",
								color: "#c0c0d0",
								fontSize: 12,
							}}
						/>
						<p className="text-[11px] mt-1" style={{ color: "#4a4a5a" }}>
							Runs once when a new worktree is created for a task.
						</p>
					</div>
				</div>
			</div>

			{/* Pinned footer */}
			<div
				className="flex items-center shrink-0"
				style={{ gap: 8, padding: "12px 24px", borderTop: "1px solid #2a2a35" }}
			>
				<button
					onClick={onBack}
					className="flex items-center hover:opacity-80 transition-opacity"
					style={{ gap: 5, padding: "9px 18px", border: "1px solid #2a2a35", borderRadius: 6 }}
				>
					<ArrowLeft size={14} style={{ color: "#8888a0" }} />
					<span className="text-[13px]" style={{ color: "#8888a0" }}>
						Back
					</span>
				</button>
				<div style={{ flex: 1 }} />
				<button
					onClick={onAdd}
					disabled={adding}
					className="hover:opacity-80 transition-opacity disabled:opacity-40"
					style={{ padding: "9px 18px", border: "1px solid #2a2a35", borderRadius: 6 }}
				>
					<span className="text-[13px]" style={{ color: "#8888a0" }}>
						Skip Setup
					</span>
				</button>
				<button
					onClick={onAdd}
					disabled={adding}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40"
					style={{ gap: 6, padding: "9px 18px", background: "#7c6aff", borderRadius: 6 }}
				>
					<Plus size={14} style={{ color: "#ffffff" }} />
					<span className="text-[13px] font-medium" style={{ color: "#ffffff" }}>
						{adding ? "Creating..." : "Create Project"}
					</span>
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
				<p className="text-[13px]" style={{ color: "#c0c0d0" }}>
					{label}
				</p>
				<p className="text-[11px] mt-0.5" style={{ color: "#4a4a5a" }}>
					{description}
				</p>
			</div>
			<button
				onClick={() => onChange(!checked)}
				className="shrink-0 transition-colors"
				style={{
					width: 36,
					height: 20,
					borderRadius: 10,
					background: checked ? "#7c6aff" : "#2a2a35",
					position: "relative",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: 3,
						left: checked ? 19 : 3,
						width: 14,
						height: 14,
						borderRadius: "50%",
						background: "#ffffff",
						transition: "left 0.15s",
					}}
				/>
			</button>
		</div>
	);
}
