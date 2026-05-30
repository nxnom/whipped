import { ConfirmDialog, Dialog, toast } from "@geckoui/geckoui";
import type { RuntimeBoardCard } from "@runtime-contract";
import { useState } from "react";
import { useWrite } from "@/runtime/api-client";
import { CommitMsgDialog } from "./CommitMsgDialog";

interface UseCardActionsArgs {
	workspaceId: string;
	card: RuntimeBoardCard;
	onRefresh: () => void;
	onClose: () => void;
	onDeleteCard: (cardId: string) => void;
}

export function useCardActions({ workspaceId, card, onRefresh, onClose, onDeleteCard }: UseCardActionsArgs) {
	const { trigger: stopAgentTrigger } = useWrite((api) => api("cards/stop-agent").POST());
	const { trigger: commitAndMergeTrigger } = useWrite((api) => api("cards/commit-and-merge").POST());
	const { trigger: commitAndPRTrigger } = useWrite((api) => api("cards/commit-and-pr").POST());
	const { trigger: deleteCardTrigger } = useWrite((api) => api("cards/:id").DELETE());
	const [merging, setMerging] = useState(false);
	const [creatingPR, setCreatingPR] = useState(false);

	const handleStop = () => {
		ConfirmDialog.show({
			title: "Stop agent?",
			content: "The agent will be interrupted. You can restart it later.",
			confirmButtonLabel: "Stop",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				const res = await stopAgentTrigger({ body: { workspaceId, cardId: card.id } });
				if (res.error) {
					toast.error("Failed to stop agent");
					return;
				}
				dismiss();
				onRefresh();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

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
			const res = await commitAndMergeTrigger({ body: { workspaceId, cardId: card.id, commitMessage } });
			if (res.error) {
				toast.error(`Merge failed: ${res.error.message}`);
				return;
			}
			const result = res.data;
			if (result.status === "needs_commit") {
				showCommitMsgDialog((msg) => doMerge(msg), "merge");
				return;
			}
			if (result.status === "merged") {
				toast.success(`Merged into ${card.baseRef}`);
				onRefresh();
				onClose();
			} else {
				toast.success("Merge conflicts detected — resolving with AI agent...");
				onRefresh();
			}
		} finally {
			setMerging(false);
		}
	};

	const doPR = async (commitMessage?: string) => {
		setCreatingPR(true);
		try {
			const res = await commitAndPRTrigger({ body: { workspaceId, cardId: card.id, commitMessage } });
			if (res.error) {
				toast.error(`PR creation failed: ${res.error.message}`);
				return;
			}
			const result = res.data;
			if (result.status === "needs_commit") {
				showCommitMsgDialog((msg) => doPR(msg), "pr");
				return;
			}
			if (result.status === "no_token") {
				toast.error("GitHub token not configured — add GITHUB_TOKEN in project Settings > Secrets.");
				return;
			}
			toast.success("PR created");
			window.open(result.prUrl, "_blank");
			onRefresh();
		} finally {
			setCreatingPR(false);
		}
	};

	const handleCommitAndMerge = () => {
		ConfirmDialog.show({
			title: `Merge into ${card.baseRef}?`,
			content: "Commits any pending changes and merges the task branch directly. This cannot be undone.",
			confirmButtonLabel: "Merge",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				await doMerge();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleCommitAndPR = () => {
		ConfirmDialog.show({
			title: "Create Pull Request?",
			content: `Commits any pending changes, pushes the branch, and opens a PR against ${card.baseRef}.`,
			confirmButtonLabel: "Create PR",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				dismiss();
				await doPR();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	const handleDelete = () => {
		ConfirmDialog.show({
			title: "Delete task?",
			content: "This cannot be undone.",
			confirmButtonLabel: "Delete",
			cancelButtonLabel: "Cancel",
			onConfirm: async ({ dismiss }) => {
				onDeleteCard(card.id);
				dismiss();
				onClose();
				const res = await deleteCardTrigger({ params: { id: card.id }, body: { workspaceId } });
				if (res.error) {
					toast.error("Failed to delete task");
				}
				onRefresh();
			},
			onCancel: ({ dismiss }) => dismiss(),
		});
	};

	return { merging, creatingPR, handleStop, handleCommitAndMerge, handleCommitAndPR, handleDelete };
}
