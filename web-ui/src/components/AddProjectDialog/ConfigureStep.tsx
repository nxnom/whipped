import { RHFSelect, SelectOption } from "@geckoui/geckoui";
import { DEFAULT_AGENT_MODEL_CHOICE } from "@runtime-contract";
import { AlertTriangle, ArrowLeft, Plus } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { BranchSelect } from "@/components/BranchSelect";

export function ConfigureStep({
	repoPath,
	branches,
	adding,
	onBack,
	onAdd,
}: {
	repoPath: string;
	branches: string[];
	adding: boolean;
	onBack: () => void;
	onAdd: () => void;
}) {
	const { setValue } = useFormContext();
	const folderName = repoPath.split("/").filter(Boolean).at(-1) ?? repoPath;
	const deliveryMode = useWatch({ name: "deliveryMode" });
	const defaultBaseBranch = useWatch({ name: "defaultBaseBranch" }) ?? "";
	const assistantModel = useWatch({ name: "assistantModel" }) ?? DEFAULT_AGENT_MODEL_CHOICE;

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Scrollable body */}
			<div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
				<div>
					<span className="text-[15px] font-semibold text-whip-text">Configure {folderName}</span>
					<p className="text-[12px] mt-1 text-whip-faint font-mono">{repoPath}</p>
				</div>

				<div className="flex flex-col gap-3.5">
					<span className="text-[10px] font-medium uppercase text-whip-faint tracking-[1px]">Automation</span>
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-[13px] text-whip-text">Delivery mode</p>
							<p className="text-[11px] mt-0.5 text-whip-faint">What happens when a task passes review</p>
						</div>
						<div className="w-40">
							<RHFSelect name="deliveryMode">
								<SelectOption value="off" label="Off" />
								<SelectOption value="pr" label="Auto PR" />
								<SelectOption value="yolo" label="YOLO" />
							</RHFSelect>
						</div>
					</div>
					{deliveryMode === "yolo" && (
						<div className="flex items-start gap-2.5 px-3.5 py-3 rounded-md border border-[#eab308]/40 bg-[#eab308]/10">
							<AlertTriangle size={15} className="text-[#eab308] shrink-0 mt-px" />
							<p className="text-[12px] text-[#eab308]/90 leading-relaxed">
								<span className="font-semibold text-[#eab308]">YOLO merges with no PR or approval</span> — passing tasks
								land straight on the local base branch and push.
							</p>
						</div>
					)}
				</div>

				<div className="flex flex-col gap-3.5">
					<span className="text-[10px] font-medium uppercase text-whip-faint tracking-[1px]">Git defaults</span>
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-[13px] text-whip-text">Default base branch</p>
							<p className="text-[11px] mt-0.5 text-whip-faint">Used when creating new tasks and stories.</p>
						</div>
						<div className="w-40">
							<BranchSelect
								branches={branches}
								value={defaultBaseBranch}
								onChange={(v) => setValue("defaultBaseBranch", v || undefined, { shouldDirty: true })}
								placeholder="main"
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col gap-2.5">
					<span className="text-[10px] font-medium uppercase text-whip-faint tracking-[1px]">Assistant</span>
					<div className="flex flex-col gap-1.5">
						<p className="text-[13px] text-whip-text">Agent &amp; model</p>
						<p className="text-[11px] text-whip-faint">Which agent runs the in-app assistant.</p>
						<div className="mt-1">
							<AgentModelPicker
								value={assistantModel}
								onChange={(next) => setValue("assistantModel", next, { shouldDirty: true })}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Pinned footer */}
			<div className="flex items-center shrink-0 gap-2 px-6 py-3 border-t border-whip-border">
				<button
					onClick={onBack}
					className="flex items-center hover:opacity-80 transition-opacity gap-[5px] px-[18px] py-[9px] border border-whip-border rounded-md"
				>
					<ArrowLeft size={14} className="text-whip-muted" />
					<span className="text-[13px] text-whip-muted">Back</span>
				</button>
				<div className="flex-1" />
				<button
					onClick={onAdd}
					disabled={adding}
					className="hover:opacity-80 transition-opacity disabled:opacity-40 px-[18px] py-[9px] border border-whip-border rounded-md"
				>
					<span className="text-[13px] text-whip-muted">Skip Setup</span>
				</button>
				<button
					onClick={onAdd}
					disabled={adding}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40 gap-1.5 px-[18px] py-[9px] bg-whip-accent rounded-md"
				>
					<Plus size={14} className="text-whip-accent-text" />
					<span className="text-[13px] font-medium text-whip-accent-text">
						{adding ? "Creating..." : "Create Project"}
					</span>
				</button>
			</div>
		</div>
	);
}
