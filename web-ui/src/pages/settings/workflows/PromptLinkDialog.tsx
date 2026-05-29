import { Button, Dialog, Input, toast } from "@geckoui/geckoui";
import { FileText, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FilePickerDialog } from "@/components/FilePickerDialog";
import { trpc } from "@/runtime/trpc-client";

// Sanitise a workflow/slot name into a filesystem-safe slug.
function slug(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "prompt"
	);
}

// Default prompt-file path: <repo>/.whipped/prompts/<workflow>.<slot>.md
export function defaultPromptPath(repoPath: string, workflowName: string, slotName: string): string {
	const base = repoPath.replace(/\/+$/, "");
	return `${base}/.whipped/prompts/${slug(workflowName)}.${slug(slotName)}.md`;
}

function PromptLinkContent({
	workspaceId,
	defaultPath,
	currentInline,
	dismiss,
	onLinked,
}: {
	workspaceId: string;
	defaultPath: string;
	currentInline: string;
	dismiss: () => void;
	onLinked: (path: string, content: string) => void;
}) {
	const [path, setPath] = useState(defaultPath);
	const [browsing, setBrowsing] = useState(false);
	const [busy, setBusy] = useState(false);
	// When the chosen file already has content that differs from the current
	// inline prompt, ask the user which one wins.
	const [conflict, setConflict] = useState<{ fileContent: string } | null>(null);

	const link = async (content: string, write: boolean) => {
		try {
			if (write) {
				await trpc.workflows.writePromptFile.mutate({
					workspaceId,
					path,
					content,
				});
			}
			onLinked(path, content);
			toast(`Linked to ${path}`);
			dismiss();
		} catch (err) {
			toast.error(`Link failed: ${(err as Error).message}`);
		}
	};

	const handleLink = async () => {
		if (!path.trim()) return;
		setBusy(true);
		try {
			const res = await trpc.workflows.readPromptFile.query({
				workspaceId,
				path,
			});
			const hasInline = currentInline.trim().length > 0;
			const hasFile = res.exists && res.content.trim().length > 0;

			if (!hasFile) {
				// File missing or empty → seed it with the current inline prompt.
				await link(currentInline, true);
			} else if (!hasInline) {
				// Nothing to lose → adopt the file's existing content.
				await link(res.content, false);
			} else {
				// Both sides have content → ask which to keep.
				setConflict({ fileContent: res.content });
			}
		} catch (err) {
			toast.error(`Couldn't read file: ${(err as Error).message}`);
		} finally {
			setBusy(false);
		}
	};

	if (conflict) {
		return createPortal(
			// Backdrop click closes the conflict view; clicks inside the panel don't.
			<div
				className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/80 p-6"
				onClick={() => setConflict(null)}
			>
				<div
					className="flex flex-col w-[92vw] max-w-[1200px] h-[85vh] bg-[#141418] border border-[#2a2a35] rounded-xl shadow-[0_8px_40px_4px_#00000060] overflow-hidden"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center shrink-0 gap-3 px-6 py-4 border-b border-[#2a2a35]">
						<FileText size={18} className="text-[#7c6aff] shrink-0" />
						<div className="flex flex-col min-w-0">
							<span className="text-[15px] font-semibold text-[#f0f0f5]">File already has content</span>
							<span className="text-[12px] text-[#60607a] font-mono truncate">{path}</span>
						</div>
						<div className="flex-1" />
						<button onClick={() => setConflict(null)} className="hover:opacity-70 transition-opacity shrink-0">
							<X size={18} className="text-[#60607a]" />
						</button>
					</div>

					{/* Two plain side-by-side panels — each labeled, with its own action */}
					<div className="flex-1 grid grid-cols-2 gap-4 p-6 min-h-0">
						{/* File content */}
						<div className="flex flex-col min-h-0 gap-2">
							<div className="flex items-center gap-2 shrink-0">
								<span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
								<span className="text-[13px] font-semibold text-[#f0f0f5]">File content</span>
								<span className="font-mono text-[10px] text-[#60607a]">{conflict.fileContent.length} chars</span>
								<div className="flex-1" />
								<Button size="sm" variant="outlined" onClick={() => link(conflict.fileContent, false)}>
									Keep this
								</Button>
							</div>
							<textarea
								readOnly
								value={conflict.fileContent}
								className="flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-lg p-4 resize-none outline-none font-mono text-[12px] text-[#c0c0d0] leading-relaxed w-full min-h-0"
							/>
						</div>

						{/* Current prompt */}
						<div className="flex flex-col min-h-0 gap-2">
							<div className="flex items-center gap-2 shrink-0">
								<span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" />
								<span className="text-[13px] font-semibold text-[#f0f0f5]">Your current prompt</span>
								<span className="font-mono text-[10px] text-[#60607a]">{currentInline.length} chars</span>
								<div className="flex-1" />
								<Button size="sm" onClick={() => link(currentInline, true)}>
									Use this
								</Button>
							</div>
							<textarea
								readOnly
								value={currentInline}
								className="flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-lg p-4 resize-none outline-none font-mono text-[12px] text-[#c0c0d0] leading-relaxed w-full min-h-0"
							/>
						</div>
					</div>
				</div>
			</div>,
			document.body,
		);
	}

	return (
		<>
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-2">
					<FileText size={16} className="text-[#7c6aff]" />
					<h3 className="text-[15px] font-semibold text-[#f0f0f5]">Link prompt to a file</h3>
				</div>
				<p className="text-[13px] text-[#8888a0] leading-relaxed">
					The agent reads this file at runtime. Edits auto-save back to it, and changes you make in your own editor are
					picked up too.
				</p>
				<div className="flex flex-col gap-1.5">
					<span className="text-[12px] font-medium text-[#c0c0d0]">File path</span>
					<div className="flex gap-2">
						<Input
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="/path/to/repo/.whipped/prompts/dev.md"
							inputClassName="font-mono text-[12px]"
							className="flex-1"
						/>
						<Button variant="outlined" onClick={() => setBrowsing(true)}>
							<span className="flex items-center gap-1.5">
								<FolderOpen size={13} />
								Browse
							</span>
						</Button>
					</div>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={dismiss}>
						Cancel
					</Button>
					<Button onClick={handleLink} disabled={busy || !path.trim()}>
						Link
					</Button>
				</div>
			</div>

			{browsing && (
				<FilePickerDialog
					initialPath={path.replace(/\/[^/]*$/, "") || undefined}
					onSelect={(p) => {
						setPath(p);
						setBrowsing(false);
					}}
					onClose={() => setBrowsing(false)}
				/>
			)}
		</>
	);
}

export function showPromptLinkDialog(opts: {
	workspaceId: string;
	defaultPath: string;
	currentInline: string;
	onLinked: (path: string, content: string) => void;
}) {
	Dialog.show({
		className: "max-w-lg w-full",
		// Outside-click dismiss is disabled because the conflict/file-picker views
		// portal to <body> (outside this dialog's panel); GeckoUI's document-level
		// outside-click listener would otherwise treat clicks in them — including on
		// the diff textareas — as "outside" and close the whole dialog.
		dismissOnOutsideClick: false,
		content: ({ dismiss }) => <PromptLinkContent {...opts} dismiss={dismiss} />,
	});
}
