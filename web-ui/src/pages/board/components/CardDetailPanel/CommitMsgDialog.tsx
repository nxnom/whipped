import { Button, Input } from "@geckoui/geckoui";
import { useState } from "react";

export function CommitMsgDialog({
	dismiss,
	action,
	onSubmit,
}: {
	dismiss: () => void;
	action: "merge" | "pr";
	onSubmit: (msg: string) => void;
}) {
	const [msg, setMsg] = useState("");
	const handleSubmit = () => {
		if (!msg.trim()) return;
		dismiss();
		onSubmit(msg.trim());
	};
	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-base font-semibold text-[#ededed]">Commit pending changes</h3>
				<p className="text-sm text-[#8a8f98] mt-1">There are uncommitted changes. Enter a commit message to proceed.</p>
			</div>
			<Input
				placeholder="Commit message"
				value={msg}
				onChange={(e) => setMsg(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleSubmit();
					if (e.key === "Escape") dismiss();
				}}
				autoFocus
			/>
			<div className="flex justify-end gap-2">
				<Button variant="outlined" size="sm" onClick={dismiss}>
					Cancel
				</Button>
				<Button size="sm" onClick={handleSubmit} disabled={!msg.trim()}>
					{action === "merge" ? "Commit & Merge" : "Commit & Create PR"}
				</Button>
			</div>
		</div>
	);
}
