import { LoadingButton, toast } from "@geckoui/geckoui";
import { useState } from "react";
import { optimistic, useWrite } from "@/runtime/api-client";

const SAVE_INSTRUCTION =
	"Please consolidate everything you've proposed across this session's canvas versions into one final canvas and save it via the whipped_save_canvas tool with a short title.";

export function CanvasApproveOutcomeDialog({
	dismiss,
	sessionId,
	sendFeedback,
	composedApproval,
	onSent,
}: {
	dismiss: () => void;
	sessionId: string;
	sendFeedback: (text: string) => Promise<void>;
	composedApproval: string;
	onSent: () => void;
}) {
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const { trigger: deleteCanvases } = useWrite((api) => api("companion-sessions/:id/canvases").DELETE());

	// Nothing was sent when Approve was clicked — this is the first (and only)
	// message that reaches the agent, folding the approval together with the
	// save instruction so it's one terminal write, not two.
	const onSave = async () => {
		setSaving(true);
		try {
			await sendFeedback(`${composedApproval}\n\n${SAVE_INSTRUCTION}`);
			onSent();
			toast.success("Canvas approved — asked the agent to save it");
			dismiss();
		} catch {
			toast.error("Failed to send feedback");
			setSaving(false);
		}
	};

	// Still exactly one message to the agent (the approval, unmodified) — the
	// history delete is a separate, local mutation, not something the agent
	// needs to know about.
	const onDelete = async () => {
		setDeleting(true);
		try {
			await sendFeedback(composedApproval);
		} catch {
			toast.error("Failed to send feedback");
			setDeleting(false);
			return;
		}
		const res = await deleteCanvases({ params: { id: sessionId } });
		if (res.error) {
			toast.error("Approved, but failed to delete canvas history");
			onSent();
			dismiss();
			return;
		}
		optimistic((cache) =>
			cache("companion-sessions/:id/canvases")
				.filter((entry) => entry.params.id === sessionId)
				.set(() => ({ canvases: [] })),
		);
		onSent();
		toast.success("Canvas approved and history deleted");
		dismiss();
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-base font-semibold text-gray-100">Approve and...</h3>
				<p className="text-sm text-gray-400 mt-1">
					Your approval hasn't been sent yet. Save asks the agent to consolidate every version into one final, reusable
					canvas; Delete clears this session's canvas history instead. Either way sends your approval to the agent.
				</p>
			</div>
			<div className="flex justify-end gap-2">
				<LoadingButton
					variant="outlined"
					size="sm"
					onClick={onDelete}
					loading={deleting}
					loadingText="Deleting..."
					disabled={saving}
				>
					Delete
				</LoadingButton>
				<LoadingButton size="sm" onClick={onSave} loading={saving} loadingText="Saving..." disabled={deleting}>
					Save
				</LoadingButton>
			</div>
		</div>
	);
}
