import { RHFInput } from "@geckoui/geckoui";
import { AlertCircle, ArrowRight, CheckCircle2, Folder, Loader2 } from "lucide-react";
import { classNames } from "@/utils/classNames";
import type { PathStatus, RepoInfo } from "./types";

export function SelectStep({
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
				<span className="text-[13px] font-medium shrink-0 text-[#ededed]">Repository Path</span>

				{/* Path input row */}
				<div className="flex shrink-0 gap-2">
					<RHFInput
						name="repoPath"
						placeholder="/Users/dev/projects/my-app"
						className="flex items-center flex-1 min-w-0 bg-[#111111] border border-[#2a2a2a] rounded-md px-3.5 py-2.5 gap-2"
						inputClassName="flex-1 bg-transparent outline-none min-w-0 text-[#ededed] font-mono text-[12px]"
						onKeyDown={(e) => e.key === "Enter" && pathStatus === "valid" && onNext()}
						prefix={<Folder size={14} className="text-[#5f6672] shrink-0" />}
						suffix={
							pathStatus === "checking" ? <Loader2 size={12} className="animate-spin shrink-0 text-[#5f6672]" /> : null
						}
					/>
					<button
						onClick={onBrowse}
						className="shrink-0 hover:opacity-80 transition-opacity px-3.5 py-2.5 border border-[#2a2a2a] rounded-md"
					>
						<span className="text-[12px] text-[#8a8f98]">Browse</span>
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
							<AlertCircle size={14} className="text-[#ff3b4d] shrink-0" />
							<span className="text-[12px] text-[#ff3b4d]">{pathError ?? "Invalid path"}</span>
						</>
					)}
				</div>

				{/* Divider */}
				<div className="h-px bg-[#111111] shrink-0" />

				{/* Repo info card */}
				{pathStatus === "valid" ? (
					<div className="shrink-0 flex flex-col bg-[#111111] border border-[#2a2a2a] rounded-lg px-4 py-3.5 gap-2.5">
						<InfoRow label="Name" value={repoInfo.name ?? "—"} mono={false} />
						<InfoRow label="Branch" value={repoInfo.branch ?? "—"} mono />
						<InfoRow label="Remote" value={repoInfo.remote ?? "—"} mono />
					</div>
				) : (
					<div className="shrink-0 flex flex-col bg-[#111111] border border-[#2a2a2a] rounded-lg px-4 py-3.5 gap-2.5 opacity-40">
						<InfoRow label="Name" value="—" mono={false} />
						<InfoRow label="Branch" value="—" mono />
						<InfoRow label="Remote" value="—" mono />
					</div>
				)}

				{/* Spacer */}
				<div className="flex-1" />
			</div>

			{/* Pinned footer */}
			<div className="flex items-center justify-end shrink-0 gap-2 px-6 py-3 border-t border-[#2a2a2a]">
				<button
					onClick={onClose}
					className="hover:opacity-80 transition-opacity px-[18px] py-[9px] border border-[#2a2a2a] rounded-md"
				>
					<span className="text-[13px] text-[#8a8f98]">Cancel</span>
				</button>
				<button
					onClick={onNext}
					disabled={pathStatus !== "valid"}
					className="flex items-center hover:opacity-80 transition-opacity disabled:opacity-40 px-[18px] py-[9px] bg-[#ededed] rounded-md gap-1.5"
				>
					<span className="text-[13px] font-medium text-[#050505]">Next</span>
					<ArrowRight size={14} className="text-[#050505]" />
				</button>
			</div>
		</div>
	);
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono: boolean }) {
	return (
		<div className="flex items-center">
			<span className="text-[11px] shrink-0 text-[#5f6672] w-20">{label}</span>
			<span
				className={classNames(
					"text-[12px] truncate",
					label === "Name" ? "text-[#ededed]" : "text-[#ededed]",
					mono ? "font-mono font-normal" : "font-medium",
				)}
			>
				{value}
			</span>
		</div>
	);
}
