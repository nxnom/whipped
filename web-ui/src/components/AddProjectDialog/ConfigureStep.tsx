import { RHFError, RHFInput, RHFInputGroup, RHFSelect, SelectOption } from "@geckoui/geckoui";
import { AlertTriangle, ArrowLeft, Plus } from "lucide-react";
import { useWatch } from "react-hook-form";

export function ConfigureStep({
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
	const deliveryMode = useWatch({ name: "deliveryMode" });

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
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="text-[13px] text-[#c0c0d0]">Delivery mode</p>
							<p className="text-[11px] mt-0.5 text-[#4a4a5a]">What happens when a task passes review</p>
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
						<div className="flex items-start gap-2.5 px-3.5 py-3 rounded-md border border-amber-500/40 bg-amber-500/10">
							<AlertTriangle size={15} className="text-amber-400 shrink-0 mt-px" />
							<p className="text-[12px] text-amber-200/90 leading-relaxed">
								<span className="font-semibold text-amber-200">YOLO merges with no PR or approval</span> — passing tasks
								land straight on the local base branch and push.
							</p>
						</div>
					)}
				</div>

				<div className="flex flex-col gap-2.5">
					<span className="text-[10px] font-medium uppercase text-[#4a4a5a] tracking-[1px]">Worktree setup</span>
					<RHFInputGroup label="Install command" labelClassName="text-[12px] text-[#8888a0]" className="flex flex-col">
						<RHFInput name="installCommand" placeholder="pnpm install" />
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
