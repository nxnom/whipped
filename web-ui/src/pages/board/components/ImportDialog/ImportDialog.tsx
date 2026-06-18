import { toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard, Workflow } from "@runtime-contract";
import { ClipboardCopy, FileUp, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useWrite } from "@/runtime/api-client";
import { buildImportPrompt } from "./buildImportPrompt";
import { ImportPreviewTable } from "./ImportPreviewTable";
import { parseImport } from "./parseImport";
import type { ParsedImport } from "./types";

interface ImportDialogProps {
	open: boolean;
	onClose: () => void;
	workspaceId: string;
	workflows: Workflow[];
	allCards: Record<string, RuntimeBoardCard>;
	onRefresh: () => void;
	navigate: (path: string) => void;
}

export function ImportDialog({
	open,
	onClose,
	workspaceId,
	workflows,
	allCards,
	onRefresh,
	navigate,
}: ImportDialogProps) {
	const [rawJson, setRawJson] = useState("");
	const [parsed, setParsed] = useState<ParsedImport | null>(null);
	const [loading, setLoading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const { trigger: createBulk } = useWrite((api) => api("cards/bulk").POST());

	const hasTaskWorkflow = workflows.some((w) => !w.forStory);

	const handleClose = () => {
		setRawJson("");
		setParsed(null);
		onClose();
	};

	const validate = (text: string) => setParsed(parseImport(text, workflows, allCards));

	const handleFile = (file: File) => {
		const reader = new FileReader();
		reader.onload = () => {
			const text = String(reader.result ?? "");
			setRawJson(text);
			validate(text);
		};
		reader.readAsText(file);
	};

	const handleCopyPrompt = async () => {
		try {
			await navigator.clipboard.writeText(buildImportPrompt(workflows));
			toast.success("Prompt copied — paste it into any AI assistant to generate tickets");
		} catch {
			toast.error("Couldn't copy to clipboard");
		}
	};

	const handleImport = async () => {
		const items = parsed?.rows.map((r) => r.item).filter((i): i is NonNullable<typeof i> => Boolean(i)) ?? [];
		if (items.length === 0) return;
		setLoading(true);
		try {
			const res = await createBulk({ body: { workspaceId, cards: items } });
			if (res.error || !res.data) {
				toast.error(res.error?.message ?? "Failed to import tickets");
				return;
			}
			toast.success(`Imported ${res.data.cards.length} ticket${res.data.cards.length === 1 ? "" : "s"}`);
			handleClose();
			onRefresh();
		} finally {
			setLoading(false);
		}
	};

	if (!open) return null;

	const validCount = parsed?.rows.filter((r) => r.errors.length === 0).length ?? 0;
	const totalCount = parsed?.rows.length ?? 0;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			<div className="absolute inset-0 bg-black/70" onClick={handleClose} />

			<div className="relative flex h-[850px] max-h-[calc(100vh-80px)] w-[1100px] max-w-[calc(100vw-80px)] flex-col overflow-hidden rounded-xl border border-[#2a2a35] bg-[#141418] shadow-[0_8px_40px_4px_#00000060]">
				{/* Header */}
				<div className="flex shrink-0 items-center gap-3 border-b border-[#2a2a35] px-6 py-3.5">
					<span className="text-[15px] font-semibold text-[#f0f0f5]">Import Tickets</span>
					<div className="flex-1" />
					<button
						onClick={handleCopyPrompt}
						disabled={!hasTaskWorkflow}
						title="Copy a prompt to generate tickets with an AI assistant"
						className="flex items-center gap-1.5 rounded-md border border-[#2a2a35] bg-[#1a1a1f] px-3 py-1.5 text-xs text-[#c8c8d4] transition-colors hover:border-[#3a3a48] disabled:cursor-not-allowed disabled:opacity-40"
					>
						<ClipboardCopy size={13} />
						Copy prompt
					</button>
					<button onClick={handleClose} className="text-[#60607a] transition-colors hover:text-[#f0f0f5]">
						<X size={18} />
					</button>
				</div>

				{!hasTaskWorkflow ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
						<p className="max-w-sm text-sm text-[#8888a0]">
							You need at least one workflow before importing tickets. Create one in Settings → Workflows.
						</p>
						<button
							onClick={() => {
								handleClose();
								navigate(`/${encodeURIComponent(workspaceId)}/settings/workflows`);
							}}
							className="rounded-md bg-[#7c6aff] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#6a5ae0]"
						>
							Go to Workflows
						</button>
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
						{/* JSON input */}
						<div className="flex shrink-0 items-center gap-2">
							<span className="text-[11px] font-medium text-[#60607a]">
								Paste a JSON array of tickets, or load a file
							</span>
							<div className="flex-1" />
							<input
								ref={fileInputRef}
								type="file"
								accept=".json,application/json"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) handleFile(file);
									e.target.value = "";
								}}
							/>
							<button
								onClick={() => fileInputRef.current?.click()}
								className="flex items-center gap-1.5 rounded-md border border-[#2a2a35] bg-[#1a1a1f] px-3 py-1.5 text-xs text-[#c8c8d4] transition-colors hover:border-[#3a3a48]"
							>
								<FileUp size={13} />
								Load file
							</button>
						</div>

						<textarea
							value={rawJson}
							onChange={(e) => {
								setRawJson(e.target.value);
								if (parsed) setParsed(null);
							}}
							spellCheck={false}
							placeholder='[ { "description": "Add dark mode toggle", "workflowId": "wf_default", "priority": "high" } ]'
							className="h-44 shrink-0 resize-none rounded-lg border border-[#2a2a35] bg-[#0e0e12] px-3 py-2.5 font-mono text-xs text-[#e0e0ea] outline-none placeholder:text-[#3a3a48] focus:border-[#3a3a48]"
						/>

						<div className="flex shrink-0 items-center gap-3">
							<button
								onClick={() => validate(rawJson)}
								disabled={!rawJson.trim()}
								className="rounded-md border border-[#2a2a35] bg-[#1a1a1f] px-3 py-1.5 text-xs text-[#c8c8d4] transition-colors hover:border-[#3a3a48] disabled:cursor-not-allowed disabled:opacity-40"
							>
								Validate
							</button>
							{parsed && !parsed.fatal && (
								<span className="text-[11px] text-[#8888a0]">
									{validCount}/{totalCount} valid
									{validCount < totalCount && " — fix the highlighted rows to import"}
								</span>
							)}
						</div>

						{/* Preview / errors */}
						<div className="min-h-0 flex-1 overflow-hidden">
							{parsed?.fatal && (
								<div className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2.5 text-xs text-red-400">
									{parsed.fatal}
								</div>
							)}
							{parsed && !parsed.fatal && <ImportPreviewTable rows={parsed.rows} />}
						</div>
					</div>
				)}

				{/* Footer */}
				{hasTaskWorkflow && (
					<div className="flex shrink-0 items-center gap-2.5 border-t border-[#2a2a35] px-6 py-3.5">
						<div className="flex-1" />
						<button
							onClick={handleClose}
							className="px-4 py-2 text-xs font-medium text-[#8888a0] transition-colors hover:text-[#f0f0f5]"
						>
							Cancel
						</button>
						<button
							onClick={handleImport}
							disabled={loading || !parsed?.valid}
							className="flex items-center gap-1.5 rounded-md bg-[#7c6aff] px-5 py-2 text-xs font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
						>
							<Upload size={14} />
							{loading
								? "Importing..."
								: `Import ${totalCount > 0 ? totalCount : ""} ${totalCount === 1 ? "ticket" : "tickets"}`.trim()}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
