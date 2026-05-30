import { RHFError, RHFInput, RHFInputGroup, RHFSwitch } from "@geckoui/geckoui";
import { ArrowLeft, Plus } from "lucide-react";

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
