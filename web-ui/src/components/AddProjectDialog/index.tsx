import { toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_AGENT_MODEL_CHOICE, type RuntimeProjectConfig } from "@runtime-contract";
import { addProjectSchema } from "@runtime-validation/project";
import { FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { FolderPickerDialog } from "../FolderPickerDialog";
import { ConfigureStep } from "./ConfigureStep";
import { SelectStep } from "./SelectStep";
import type { PathStatus, Props, RepoInfo, Step } from "./types";

export function AddProjectDialog({ onClose, onAdded }: Props) {
	const methods = useForm({
		resolver: zodResolver(addProjectSchema),
		values: {
			repoPath: "",
			deliveryMode: "off" as const,
			defaultBaseBranch: undefined,
			assistantModel: DEFAULT_AGENT_MODEL_CHOICE,
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

	// Seed the base branch with the repo's current branch once it's detected, so
	// adding a repo checked out on `develop` defaults to `develop`. Only fills an
	// empty value, so a user's explicit pick is never overwritten.
	const currentBranch = repoInfo.branch;
	useEffect(() => {
		if (currentBranch && !getValues("defaultBaseBranch")) {
			setValue("defaultBaseBranch", currentBranch);
		}
	}, [currentBranch, getValues, setValue]);

	const addProjectWrite = useWrite((api) => api("projects").POST());

	const handleAdd = methods.handleSubmit(async (values) => {
		const initialConfig: Partial<RuntimeProjectConfig> = {
			deliveryMode: values.deliveryMode,
			defaultBaseBranch: values.defaultBaseBranch?.trim() || undefined,
			assistantModel: values.assistantModel,
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
					className="flex flex-col overflow-hidden w-[560px] h-[580px] bg-[#0b0b0b] border border-[#2a2a2a] rounded-xl shadow-[0_8px_40px_4px_#00000060]"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center shrink-0 gap-3 px-6 py-[18px] border-b border-[#2a2a2a]">
						<FolderPlus size={18} className="text-[#ffffff] shrink-0" />
						<span className="text-[16px] font-semibold text-[#ededed]">Add Project</span>
						<div className="flex-1" />
						<button onClick={onClose} className="hover:opacity-70 transition-opacity">
							<X size={16} className="text-[#5f6672]" />
						</button>
					</div>

					{/* Step indicator */}
					<div className="flex items-center shrink-0 gap-2 px-6 py-4 border-b border-[#2a2a2a]">
						{/* Step 1 */}
						<div className="flex items-center gap-2">
							<div
								className={classNames(
									"flex items-center justify-center shrink-0 w-[22px] h-[22px] rounded-full",
									step === "select" ? "bg-[#ffffff]" : "bg-[#111111] border border-[#2a2a2a]",
								)}
							>
								<span
									className={classNames(
										"text-[11px] font-bold",
										step === "select" ? "text-[#050505]" : "text-[#5f6672]",
									)}
								>
									1
								</span>
							</div>
							<span
								className={classNames(
									"text-[12px]",
									step === "select" ? "text-[#ededed] font-semibold" : "text-[#5f6672]",
								)}
							>
								Select Repository
							</span>
						</div>

						{/* Connector */}
						<div className="w-6 h-px bg-[#2a2a2a] shrink-0" />

						{/* Step 2 */}
						<div className="flex items-center gap-2">
							<div
								className={classNames(
									"flex items-center justify-center shrink-0 w-[22px] h-[22px] rounded-full",
									step === "configure" ? "bg-[#ffffff]" : "bg-[#111111] border border-[#2a2a2a]",
								)}
							>
								<span
									className={classNames(
										"text-[11px] font-semibold",
										step === "configure" ? "text-[#050505]" : "text-[#5f6672]",
									)}
								>
									2
								</span>
							</div>
							<span
								className={classNames(
									"text-[12px]",
									step === "configure" ? "text-[#ededed] font-semibold" : "text-[#5f6672]",
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
							branches={pathData?.branches ?? []}
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
