import { ConfirmDialog, Dialog, toast } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { useState } from "react";
import { CommitMsgDialog } from "@/pages/board/components/CardDetailPanel/CommitMsgDialog";
import { CompanionPRDialog } from "./CompanionPRDialog";
import { useCompanionSessions } from "./useCompanionSessions";

export function useCompanionActions(workspaceId: string, session: CompanionSession, onRefresh: () => void) {
	const { commitAndMerge } = useCompanionSessions(workspaceId);
	const [merging, setMerging] = useState(false);

	const showCommitMsgDialog = (onSubmit: (msg: string) => void, action: "merge" | "pr") => {
		setTimeout(() => {
			Dialog.show({
				className: "max-w-md w-full",
				dismissOnOutsideClick: true,
				content: ({ dismiss }) => <CommitMsgDialog dismiss={dismiss} action={action} onSubmit={onSubmit} />,
			});
		}, 400);
	};

	const doMerge = async (commitMessage?: string) => {
		setMerging(true);
		try {
			const res = await commitAndMerge.trigger({ params: { id: session.id }, body: { workspaceId, commitMessage } });
			if (res.error || !res.data) {
				toast.error(`Merge failed: ${res.error?.message ?? "unknown error"}`);
				return;
			}
			const result = res.data;
			if (result.status === "needs_commit") {
				showCommitMsgDialog((msg) => doMerge(msg), "merge");
				return;
			}
			if (result.status === "merged") {
				toast.success(`Merged into ${session.baseRef}`);
			} else if (result.status === "conflict") {
				toast.error(`Merge conflicts in: ${result.conflictedFiles.join(", ")} — merge aborted, worktree removed.`);
			} else {
				toast.error("Base branch has uncommitted changes — resolve those first.");
			}
			onRefresh();
		} finally {
			setMerging(false);
		}
	};

	const handleMerge = () => {
		ConfirmDialog.show({
			title: `Merge into ${session.baseRef}?`,
			content: "Commits any pending changes and merges the branch directly. This removes the session's worktree.",
			confirmButtonLabel: "Merge",
			cancelButtonLabel: "Cancel",
			onConfirm: ({ dismiss }) => {
				dismiss();
				void doMerge();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCreatePR = () => {
		Dialog.show({
			className: "max-w-lg w-full",
			dismissOnOutsideClick: true,
			content: ({ dismiss }) => (
				<CompanionPRDialog
					dismiss={dismiss}
					workspaceId={workspaceId}
					sessionId={session.id}
					defaultBaseRef={session.baseRef}
					onSuccess={onRefresh}
					onNeedsCommit={(retry) => showCommitMsgDialog(retry, "pr")}
				/>
			),
		});
	};

	return { merging, handleMerge, handleCreatePR };
}
