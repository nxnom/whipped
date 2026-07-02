import { Button, Dialog, RHFError, RHFInput, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type PromptLinkForm, promptLinkFormSchema } from "@runtime-validation/workflow";
import { FileText, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FormProvider, useForm } from "react-hook-form";
import { FilePickerDialog } from "@/components/FilePickerDialog";
import { useRead, useWrite } from "@/runtime/api-client";

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
	const methods = useForm<PromptLinkForm, unknown, PromptLinkForm>({
		resolver: zodResolver(promptLinkFormSchema),
		values: { path: defaultPath },
	});
	const { handleSubmit, setValue, watch } = methods;
	const path = watch("path");

	const [browsing, setBrowsing] = useState(false);
	const [busy, setBusy] = useState(false);
	// When the chosen file already has content that differs from the current
	// inline prompt, ask the user which one wins.
	const [conflict, setConflict] = useState<{ fileContent: string } | null>(null);

	const { trigger: writePromptFile } = useWrite((api) => api("workflows/prompt-file").POST());
	// Lazy read: the builder needs a query shape, but the actual path is supplied
	// per-fetch via trigger({ query }).
	const { trigger: readPromptFile } = useRead(
		(api) => api("workflows/prompt-file").GET({ query: { workspaceId, path: "" } }),
		{ enabled: false },
	);

	const link = async (content: string, write: boolean) => {
		if (write) {
			const res = await writePromptFile({ body: { workspaceId, path, content } });
			if (res.error) {
				toast.error(`Link failed: ${res.error.message}`);
				return;
			}
		}
		onLinked(path, content);
		toast(`Linked to ${path}`);
		dismiss();
	};

	const handleLink = async ({ path: target }: PromptLinkForm) => {
		setBusy(true);
		try {
			const res = await readPromptFile({ query: { workspaceId, path: target } });
			if (res.error) {
				toast.error(`Couldn't read file: ${res.error.message}`);
				return;
			}
			const hasInline = currentInline.trim().length > 0;
			const hasFile = res.data.exists && res.data.content.trim().length > 0;

			if (!hasFile) {
				// File missing or empty → seed it with the current inline prompt.
				await link(currentInline, true);
			} else if (!hasInline) {
				// Nothing to lose → adopt the file's existing content.
				await link(res.data.content, false);
			} else {
				// Both sides have content → ask which to keep.
				setConflict({ fileContent: res.data.content });
			}
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
					className="flex flex-col w-[92vw] max-w-[1200px] h-[85vh] bg-whip-surface border border-whip-border rounded-xl shadow-[0_8px_40px_4px_#00000060] overflow-hidden"
					onClick={(e) => e.stopPropagation()}
				>
					{/* Header */}
					<div className="flex items-center shrink-0 gap-3 px-6 py-4 border-b border-whip-border">
						<FileText size={18} className="text-whip-accent shrink-0" />
						<div className="flex flex-col min-w-0">
							<span className="text-[15px] font-semibold text-whip-text">File already has content</span>
							<span className="text-[12px] text-whip-faint font-mono truncate">{path}</span>
						</div>
						<div className="flex-1" />
						<button onClick={() => setConflict(null)} className="hover:opacity-70 transition-opacity shrink-0">
							<X size={18} className="text-whip-faint" />
						</button>
					</div>

					{/* Two plain side-by-side panels — each labeled, with its own action */}
					<div className="flex-1 grid grid-cols-2 gap-4 p-6 min-h-0">
						{/* File content */}
						<div className="flex flex-col min-h-0 gap-2">
							<div className="flex items-center gap-2 shrink-0">
								<span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
								<span className="text-[13px] font-semibold text-whip-text">File content</span>
								<span className="font-mono text-[10px] text-whip-faint">{conflict.fileContent.length} chars</span>
								<div className="flex-1" />
								<Button size="sm" variant="outlined" onClick={() => link(conflict.fileContent, false)}>
									Keep this
								</Button>
							</div>
							<textarea
								readOnly
								value={conflict.fileContent}
								className="flex-1 bg-whip-panel border border-whip-border rounded-lg p-4 resize-none outline-none font-mono text-[12px] text-whip-text leading-relaxed w-full min-h-0"
							/>
						</div>

						{/* Current prompt */}
						<div className="flex flex-col min-h-0 gap-2">
							<div className="flex items-center gap-2 shrink-0">
								<span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" />
								<span className="text-[13px] font-semibold text-whip-text">Your current prompt</span>
								<span className="font-mono text-[10px] text-whip-faint">{currentInline.length} chars</span>
								<div className="flex-1" />
								<Button size="sm" onClick={() => link(currentInline, true)}>
									Use this
								</Button>
							</div>
							<textarea
								readOnly
								value={currentInline}
								className="flex-1 bg-whip-panel border border-whip-border rounded-lg p-4 resize-none outline-none font-mono text-[12px] text-whip-text leading-relaxed w-full min-h-0"
							/>
						</div>
					</div>
				</div>
			</div>,
			document.body,
		);
	}

	return (
		<FormProvider {...methods}>
			<form onSubmit={handleSubmit(handleLink)} className="flex flex-col gap-4">
				<div className="flex items-center gap-2">
					<FileText size={16} className="text-whip-accent" />
					<h3 className="text-[15px] font-semibold text-whip-text">Link prompt to a file</h3>
				</div>
				<p className="text-[13px] text-whip-muted leading-relaxed">
					The agent reads this file at runtime. Edits auto-save back to it, and changes you make in your own editor are
					picked up too.
				</p>
				<div className="flex flex-col gap-1.5">
					<span className="text-[12px] font-medium text-whip-text">File path</span>
					<div className="flex gap-2">
						<RHFInput
							name="path"
							placeholder="/path/to/repo/.whipped/prompts/dev.md"
							inputClassName="font-mono text-[12px]"
							className="flex-1"
						/>
						<Button type="button" variant="outlined" onClick={() => setBrowsing(true)}>
							<span className="flex items-center gap-1.5">
								<FolderOpen size={13} />
								Browse
							</span>
						</Button>
					</div>
					<RHFError name="path" className="text-xs text-[#ff3b4d]" />
				</div>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={dismiss}>
						Cancel
					</Button>
					<Button type="submit" disabled={busy || !path.trim()}>
						Link
					</Button>
				</div>
			</form>

			{browsing && (
				<FilePickerDialog
					initialPath={path.replace(/\/[^/]*$/, "") || undefined}
					onSelect={(p) => {
						setValue("path", p, { shouldValidate: true });
						setBrowsing(false);
					}}
					onClose={() => setBrowsing(false)}
				/>
			)}
		</FormProvider>
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
