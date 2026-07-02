import { useMemo, useState } from "react";
import { useRead } from "@/runtime/api-client";
import { parseDiff } from "./parser";

// Declarative reads — the active one is chosen by selectedCommit and refetches
// automatically when it changes. Values are derived, never mirrored into state
// (Spoosh data refs change each render → a setState-in-effect would loop).
// `enabled` lets a caller that always mounts this hook (e.g. a tabbed panel)
// skip the network calls while the diff tab isn't the one showing.
export function useDiffData(workspaceId: string, cardId: string, enabled = true) {
	const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

	const { data: commitsData } = useRead((api) => api("cards/commits").GET({ query: { workspaceId, cardId } }), {
		enabled,
		staleTime: 0,
	});
	const latestDiffRead = useRead((api) => api("cards/diff").GET({ query: { workspaceId, cardId } }), {
		enabled: enabled && !selectedCommit,
		staleTime: 0,
	});
	const commitDiffRead = useRead(
		(api) =>
			api("cards/diff-for-commit").GET({
				query: { workspaceId, cardId, commitHash: selectedCommit ?? "" },
			}),
		{ enabled: enabled && !!selectedCommit, staleTime: 0 },
	);

	const activeDiffRead = selectedCommit ? commitDiffRead : latestDiffRead;
	const diffResult = activeDiffRead.data;
	const loading = activeDiffRead.loading;
	const loadError = activeDiffRead.error
		? activeDiffRead.error.message
		: diffResult
			? (diffResult.error ?? (diffResult.diff === null ? "No diff available" : null))
			: null;
	const diffText = diffResult && !diffResult.error ? diffResult.diff : null;
	const files = useMemo(() => (diffText ? parseDiff(diffText) : []), [diffText]);
	const baseBehindCount = !selectedCommit ? (latestDiffRead.data?.baseBehindCount ?? 0) : 0;
	const commits = commitsData?.commits ?? [];

	const refreshDiff = () => {
		void activeDiffRead.trigger();
	};

	return {
		selectedCommit,
		setSelectedCommit,
		files,
		loading,
		loadError,
		commits,
		baseBehindCount,
		refreshDiff,
	};
}

export type DiffCommit = ReturnType<typeof useDiffData>["commits"][number];
