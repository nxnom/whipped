import { DiffView } from "../board/components/DiffView";
import { useCompanionDiffData } from "./useCompanionDiffData";

export function CompanionDiffPanel({ sessionId }: { sessionId: string }) {
	const diffData = useCompanionDiffData(sessionId);

	return <DiffView diffData={diffData} />;
}
