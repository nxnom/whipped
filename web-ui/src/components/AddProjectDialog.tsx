import { RHFError, RHFInput, RHFInputGroup, RHFSwitch, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeProjectConfig } from "@runtime-contract";
import { addProjectSchema } from "@runtime-validation/project";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Folder, FolderPlus, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
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
	const methods = useForm({
		resolver: zodResolver(addProjectSchema),
		values: {
			repoPath: "",
			autonomousModeEnabled: false,
			autoPR: false,
			installCommand: "",
		},
	});
	const { control, getValues, setValue } = methods;

	const [step, setStep] = useState<Step>("select");
	const [showPicker, setShowPicker] = useState(false);

	const repoPath = useWatch({ control, name: "repoPath" });
	const trimmed = repoPath.trim();

	// 400ms debounce: only the settled path feeds the reactive read, so rapid
	// typing doesn't fire a check-path request per keystroke.
	const [debouncedPath, setDebouncedPath] = useState(trimmed);
	useEffect(() => {
		const id = setTimeout(() => setDebouncedPath(trimmed), 400);
		return () => clearTimeout(id);
	}, [trimmed]);

	// Reactive lazy read: re-runs whenever the debounced path changes, skipped
	// entirely while the input is empty.
	const {
		data: pathData,
		fetching: checking,
		error: checkError,
	} = useRead((api) => api("projects/check-path").GET({ query: { repoPath: debouncedPath } }), {
		enabled: debouncedPath.length > 0,
	});

	// While the typed path hasn't yet settled into the debounced value, show the
	// checking state so the spinner appears immediately on input.
	const pathStatus: PathStatus = !trimmed
		? "idle"
		: trimmed !== debouncedPath || checking
			? "checking"
			: checkError
				? "invalid"
				: pathData
					? pathData.valid
						? "valid"
						: "invalid"
					: "checking";

	const pathError: string | null = checkError
		? "Failed to check path"
		: pathStatus === "invalid"
			? (pathData?.error ?? null)
			: null;

	const repoInfo: RepoInfo =
		pathStatus === "valid" && pathData
			? { name: pathData.name, branch: pathData.branch, remote: pathData.remote }
			: { name: null, branch: null, remote: null };

	const addProjectWrite = useWrite((api) => api("projects").POST());

	const handleAdd = methods.handleSubmit(async (values) => {
		const initialConfig: Partial<RuntimeProjectConfig> = {
			autonomousModeEnabled: values.autonomousModeEnabled,
			autoPR: values.autoPR,
			worktreeSetup: values.installCommand?.trim()
				? { filesToCopy: [], installCommand: values.installCommand.trim() }
				: undefined,
		};
		const res = await addProjectWrite.trigger({
			body: { repoPath: values.repoPath.trim(), initialConfig },
		});
		if (res.error || !res.data) {
			const msg = res.error?.message ?? "Failed to add project";
			toast.error(msg);
			return;
		}
		onAdded(res.data.workspaceId);
		toast.success("Project added");
	});

	return (
		<FormProvider {...methods}>
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
							pathStatus={pathStatus}
							pathError={pathError}
							repoInfo={repoInfo}
							onBrowse={() => setShowPicker(true)}
							onNext={() => setStep("configure")}
							onClose={onClose}
						/>
					) : (
						<ConfigureStep
							repoPath={getValues("repoPath")}
							adding={addProjectWrite.loading}
							onBack={() => setStep("select")}
							onAdd={() => void handleAdd()}
						/>
					)}
				</div>
			</div>

			{showPicker && (
				<FolderPickerDialog
					initialPath={getValues("repoPath") || undefined}
					onSelect={(path) => {
						setValue("repoPath", path, { shouldValidate: true });
						setShowPicker(false);
					}}
					onClose={() => setShowPicker(false)}
				/>
			)}
		</FormProvider>
	);
}

function SelectStep({
	pathStatus,
	pathError,
	repoInfo,
	onBrowse,
	onNext,
	onClose,
}: {
	pathStatus: PathStatus;
	pathError: string | null;
	repoInfo: RepoInfo;
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
					<RHFInput
						name="repoPath"
						placeholder="/Users/dev/projects/my-app"
						className="flex items-center flex-1 min-w-0 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3.5 py-2.5 gap-2"
						inputClassName="flex-1 bg-transparent outline-none min-w-0 text-[#c0c0d0] font-mono text-[12px]"
						onKeyDown={(e) => e.key === "Enter" && pathStatus === "valid" && onNext()}
						prefix={<Folder size={14} className="text-[#60607a] shrink-0" />}
						suffix={
							pathStatus === "checking" ? <Loader2 size={12} className="animate-spin shrink-0 text-[#60607a]" /> : null
						}
					/>
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
	adding,
	onBack,
	onAdd,
}: {
	repoPath: string;
	adding: boolean;
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
						name="autonomousModeEnabled"
						label="Autonomous mode"
						description="Auto-pick and run tasks marked as Ready"
					/>
					<ToggleRow name="autoPR" label="Auto PR" description="Create a GitHub PR when all reviews pass" />
				</div>

				<div className="flex flex-col gap-2.5">
					<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">Worktree setup</span>
					<RHFInputGroup label="Install command" labelClassName="text-[12px] text-[#8888a0]" className="flex flex-col">
						<RHFInput
							name="installCommand"
							placeholder="pnpm install"
							inputClassName="mt-1.5 w-full outline-none bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-2 text-[#c0c0d0] text-[12px]"
						/>
						<RHFError name="installCommand" className="text-[11px] text-[#ef4444] mt-1" />
						<p className="text-[11px] mt-1 text-[#4a4a5a]">Runs once when a new worktree is created for a task.</p>
					</RHFInputGroup>
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

function ToggleRow({ name, label, description }: { name: string; label: string; description: string }) {
	return (
		<div className="flex items-center justify-between">
			<div>
				<p className="text-[13px] text-[#c0c0d0]">{label}</p>
				<p className="text-[11px] mt-0.5 text-[#4a4a5a]">{description}</p>
			</div>
			<RHFSwitch name={name} />
		</div>
	);
}
