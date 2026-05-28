import { Button, Dialog, Input, toast } from "@geckoui/geckoui";
import { ExternalLink, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

interface CardContext {
	id: string;
	title: string;
}

interface Props {
	workspaceId: string;
	card?: CardContext;
	dismiss: () => void;
}

// UTF-8-safe base64 encoder (handles unicode card titles).
function utf8Btoa(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function appendAnnotateHash(rawUrl: string, payload: object): string {
	const data = utf8Btoa(JSON.stringify(payload));
	const sep = rawUrl.includes("#") ? "&" : "#";
	return `${rawUrl}${sep}whipped=${encodeURIComponent(data)}`;
}

function PreviewUrlDialogBody({ workspaceId, card, dismiss }: Props) {
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		trpc.projectConfig.get
			.query({ workspaceId })
			.then((config) => {
				setUrl(config.previewUrl ?? "");
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, [workspaceId]);

	const trimmed = url.trim().replace(/\/$/, "");
	const isValid = trimmed.length > 0 && /^https?:\/\//i.test(trimmed);

	const handleSaveAndOpen = async () => {
		if (!isValid) return;
		setSubmitting(true);
		try {
			await trpc.projectConfig.setPreviewUrl.mutate({ workspaceId, url: trimmed });
			const target = card
				? appendAnnotateHash(trimmed, {
						serverUrl: window.location.origin,
						workspaceId,
						cardId: card.id,
						cardTitle: card.title,
					})
				: trimmed;
			window.open(target, "_blank", "noopener");
			dismiss();
		} catch {
			toast.error("Failed to save");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-3">
				<div className="size-9 rounded-lg bg-[#7c6aff]/15 flex items-center justify-center shrink-0">
					<Globe size={16} className="text-[#7c6aff]" />
				</div>
				<div>
					<h3 className="text-base font-semibold text-gray-100">Preview URL</h3>
					<p className="text-sm text-gray-400 mt-0.5">
						The dev server URL for this project. Saved per-workspace and used by the browser extension when annotating.
					</p>
				</div>
			</div>
			<div>
				<Input
					placeholder="http://localhost:3000"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && isValid) void handleSaveAndOpen();
						if (e.key === "Escape") dismiss();
					}}
					disabled={loading || submitting}
					autoFocus
				/>
				{url.trim() && !isValid && (
					<p className="text-[11px] text-red-400 mt-1.5">Must start with http:// or https://</p>
				)}
			</div>
			<div className="flex justify-end gap-2 pt-1">
				<Button variant="outlined" size="sm" onClick={dismiss}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSaveAndOpen} disabled={loading || submitting || !isValid}>
					<ExternalLink size={11} className="mr-1" />
					{submitting ? "Opening…" : "Save & Open"}
				</Button>
			</div>
		</div>
	);
}

export function showPreviewUrlDialog(workspaceId: string, card?: CardContext) {
	Dialog.show({
		className: "max-w-md w-full",
		dismissOnOutsideClick: true,
		content: ({ dismiss }) => <PreviewUrlDialogBody workspaceId={workspaceId} card={card} dismiss={dismiss} />,
	});
}
