import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	workspaceId: string;
	onConnectedChange: (v: boolean) => void;
	onAutonomousChange: (v: boolean) => void;
}

export function BoardPage({ workspaceId, onConnectedChange, onAutonomousChange }: Props) {
	const { state, connected, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId);

	useEffect(() => {
		onConnectedChange(connected);
	}, [connected]);
	useEffect(() => {
		if (state) {
			onAutonomousChange(state.autonomousModeEnabled);
		}
	}, [state]);

	if (!connected && !state) {
		return (
			<div className="flex-1 flex items-center justify-center flex-col gap-3 text-gray-500">
				<WifiOff size={32} />
				<p className="text-sm">Connecting to server...</p>
			</div>
		);
	}

	if (!state) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>;
	}

	return <KanbanBoard state={state} onRefresh={refetch} onDeleteCard={optimisticDeleteCard} />;
}
