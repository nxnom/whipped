import type { WorkflowSlotForm } from "@runtime-validation/workflow";
import { FileText, FolderOpen, Link as LinkIcon, Loader2, X } from "lucide-react";
import { promptInlineText, slotTypeColor } from "./helpers";
import { SaveIndicator } from "./SaveIndicator";
import type { SaveStatus } from "./types";

export function SlotInstructionsEditor({
	selectedSlot,
	saveStatus,
	pathDraft,
	setPathDraft,
	editorText,
	editorReady,
	onEditorChange,
	onLinkToFile,
	onCommitPathChange,
	onDisconnect,
	onBrowse,
}: {
	selectedSlot: WorkflowSlotForm;
	saveStatus: SaveStatus;
	pathDraft: string;
	setPathDraft: (path: string) => void;
	editorText: string;
	editorReady: boolean;
	onEditorChange: (text: string) => void;
	onLinkToFile: () => void;
	onCommitPathChange: () => void;
	onDisconnect: () => void;
	onBrowse: () => void;
}) {
	return (
		<div className="flex-1 flex flex-col overflow-hidden px-6 py-5">
			{/* Header */}
			<div className="flex items-center gap-2 shrink-0 mb-3">
				<FileText size={14} className="shrink-0" style={{ color: slotTypeColor(selectedSlot.type) }} />
				<span className="text-[14px] font-semibold text-[#ededed]">{selectedSlot.name} — Instructions</span>
				<div className="flex-1" />
				{selectedSlot.prompt.source === "file" ? (
					<SaveIndicator status={saveStatus} />
				) : (
					<>
						<span className="font-mono text-[10px] text-[#5f6672]">
							{promptInlineText(selectedSlot.prompt).length} chars
						</span>
						<button
							onClick={onLinkToFile}
							className="flex items-center gap-1.5 hover:opacity-80 transition-opacity bg-[#111111] border border-[#2a2a2a] rounded-md px-2.5 py-1"
						>
							<LinkIcon size={11} className="text-[#ffffff]" />
							<span className="text-[10px] text-[#ededed]">Link to file</span>
						</button>
					</>
				)}
			</div>

			{/* File-linked path bar */}
			{selectedSlot.prompt.source === "file" && (
				<div className="shrink-0 mb-3 flex items-center gap-2 bg-[#111111] border border-[#2a2a2a] rounded-md px-3 py-2">
					<LinkIcon size={12} className="text-[#ffffff] shrink-0" />
					<input
						type="text"
						value={pathDraft}
						onChange={(e) => setPathDraft(e.target.value)}
						onBlur={onCommitPathChange}
						onKeyDown={(e) => {
							if (e.key === "Enter") (e.target as HTMLInputElement).blur();
						}}
						placeholder="/path/to/repo/.whipped/prompts/dev.md"
						className="flex-1 bg-transparent outline-none font-mono text-[11px] text-[#ededed]"
					/>
					<button
						onClick={onBrowse}
						title="Browse for a file"
						className="shrink-0 text-[#5f6672] hover:text-[#ffffff] transition-colors"
					>
						<FolderOpen size={13} />
					</button>
					<button
						onClick={onDisconnect}
						title="Disconnect file (keep content as inline)"
						className="shrink-0 text-[#5f6672] hover:text-[#ff3b4d] transition-colors"
					>
						<X size={13} />
					</button>
				</div>
			)}

			{/* Editor box (shared by both modes) */}
			<div className="flex-1 flex flex-col overflow-hidden bg-[#111111] border border-[#2a2a2a] rounded-lg p-5">
				{editorReady ? (
					<textarea
						value={editorText}
						onChange={(e) => onEditorChange(e.target.value)}
						placeholder={
							selectedSlot.prompt.source === "file" && !pathDraft
								? "Enter a file path above to start editing..."
								: "Describe what this agent should check or do..."
						}
						disabled={selectedSlot.prompt.source === "file" && !selectedSlot.prompt.path}
						className="flex-1 bg-transparent resize-none outline-none font-mono text-[13px] text-[#ededed] leading-relaxed w-full min-h-0 disabled:opacity-50"
					/>
				) : (
					<div className="flex-1 flex items-center justify-center gap-2 text-[12px] text-[#5f6672]">
						<Loader2 size={14} className="animate-spin" />
						Loading file…
					</div>
				)}
			</div>

			{selectedSlot.prompt.source === "file" && (
				<p className="shrink-0 mt-2 text-[11px] text-[#5f6672] leading-relaxed">
					Edits auto-save to the file and are also picked up if you edit it in your own editor. The agent reads this
					file at runtime.
				</p>
			)}
		</div>
	);
}
