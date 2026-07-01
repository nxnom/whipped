import { useMemo, useState } from "react";
import { useRead } from "@/runtime/api-client";
import { parseDiff } from "../board/components/DiffView/parser";

// Mirrors useDiffData (board/components/DiffView) but reads a companion session's
// diff endpoints instead of a card's — no cardId/board lookup involved.
export function useCompanionDiffData(sessionId: string) {
	const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

	const { data: commitsData } = useRead(
		(api) => api("companion-sessions/:id/commits").GET({ params: { id: sessionId } }),
		{
			staleTime: 0,
		},
	);
	const latestDiffRead = useRead((api) => api("companion-sessions/:id/diff").GET({ params: { id: sessionId } }), {
		enabled: !selectedCommit,
		staleTime: 0,
	});
	const commitDiffRead = useRead(
		(api) =>
			api("companion-sessions/:id/diff-for-commit").GET({
				params: { id: sessionId },
				query: { commitHash: selectedCommit ?? "" },
			}),
		{ enabled: !!selectedCommit, staleTime: 0 },
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
