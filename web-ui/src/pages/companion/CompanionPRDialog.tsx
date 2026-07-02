import { Button, Input, LoadingButton, Textarea, toast } from "@geckoui/geckoui";
import { useState } from "react";
import { BranchSelect } from "@/components/BranchSelect";
import { useRead } from "@/runtime/api-client";
import { useCompanionSessions } from "./useCompanionSessions";

export function CompanionPRDialog({
	dismiss,
	workspaceId,
	sessionId,
	defaultBaseRef,
	onSuccess,
	onNeedsCommit,
}: {
	dismiss: () => void;
	workspaceId: string;
	sessionId: string;
	defaultBaseRef: string;
	onSuccess: () => void;
	onNeedsCommit: (retry: (commitMessage: string) => void) => void;
}) {
	const { data } = useRead((api) => api("cards/branches").GET({ query: { workspaceId, remote: "true" } }));
	const { commitAndPR } = useCompanionSessions(workspaceId);
	const remoteBranches = data?.branches ?? [];
	const branches = remoteBranches.includes(defaultBaseRef) ? remoteBranches : [defaultBaseRef, ...remoteBranches];
	const [baseRef, setBaseRef] = useState(defaultBaseRef);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");

	const createPR = async (commitMessage?: string) => {
		const res = await commitAndPR.trigger({
			params: { id: sessionId },
			body: { workspaceId, commitMessage, baseRef, title: title.trim(), description },
		});
		if (res.error || !res.data) {
			toast.error(`PR creation failed: ${res.error?.message ?? "unknown error"}`);
			return;
		}
		const result = res.data;
		if (result.status === "needs_commit") {
			dismiss();
			onNeedsCommit((msg) => createPR(msg));
			return;
		}
		if (result.status === "no_token") {
			toast.error("GitHub token not configured — add GITHUB_TOKEN in project Settings > Secrets.");
			return;
		}
		toast.success("PR created");
		window.open(result.prUrl, "_blank");
		onSuccess();
		dismiss();
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-base font-semibold text-whip-text">Create Pull Request?</h3>
				<p className="text-sm text-whip-muted mt-1">
					Commits any pending changes, pushes the branch, and opens a PR against the selected base branch.
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium text-whip-faint">Base branch</span>
				<BranchSelect branches={branches} value={baseRef} onChange={setBaseRef} placeholder="Select base branch" />
			</div>
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium text-whip-faint">Title</span>
				<Input placeholder="PR title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
			</div>
			<div className="flex flex-col gap-2">
				<span className="text-[11px] font-medium text-whip-faint">Description</span>
				<Textarea
					placeholder="What changed and why"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					className="min-h-[100px]"
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="outlined" size="sm" onClick={dismiss} disabled={commitAndPR.loading}>
					Cancel
				</Button>
				<LoadingButton
					size="sm"
					onClick={() => createPR()}
					loading={commitAndPR.loading}
					loadingText="Creating..."
					disabled={!baseRef || !title.trim()}
				>
					Create PR
				</LoadingButton>
			</div>
		</div>
	);
}
