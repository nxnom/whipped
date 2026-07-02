import { Button, LoadingButton, toast } from "@geckoui/geckoui";
import { useState } from "react";
import { BranchSelect } from "@/components/BranchSelect";
import { useRead, useWrite } from "@/runtime/api-client";

export function CreatePRDialog({
	dismiss,
	workspaceId,
	cardId,
	defaultBaseRef,
	onSuccess,
	onNeedsCommit,
}: {
	dismiss: () => void;
	workspaceId: string;
	cardId: string;
	defaultBaseRef: string;
	onSuccess: () => void;
	onNeedsCommit: (retry: (commitMessage: string) => void) => void;
}) {
	const { data } = useRead((api) => api("cards/branches").GET({ query: { workspaceId, remote: "true" } }));
	const { trigger: commitAndPRTrigger, loading } = useWrite((api) => api("cards/commit-and-pr").POST());
	const remoteBranches = data?.branches ?? [];
	const branches = remoteBranches.includes(defaultBaseRef) ? remoteBranches : [defaultBaseRef, ...remoteBranches];
	const [baseRef, setBaseRef] = useState(defaultBaseRef);

	const createPR = async (commitMessage?: string) => {
		const res = await commitAndPRTrigger({
			body: { workspaceId, cardId, commitMessage, baseRef },
		});
		if (res.error) {
			toast.error(`PR creation failed: ${res.error.message}`);
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
			<div className="flex justify-end gap-2">
				<Button variant="outlined" size="sm" onClick={dismiss} disabled={loading}>
					Cancel
				</Button>
				<LoadingButton
					size="sm"
					onClick={() => createPR()}
					loading={loading}
					loadingText="Creating..."
					disabled={!baseRef}
				>
					Create PR
				</LoadingButton>
			</div>
		</div>
	);
}
