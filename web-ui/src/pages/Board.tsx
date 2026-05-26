import { WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	onConnectedChange: (v: boolean) => void;
	onAutonomousChange: (v: boolean) => void;
	onOpenSettings: () => void;
	onOpenAgent: () => void;
	projectName?: string;
}

export function BoardPage({ onConnectedChange, onAutonomousChange, onOpenSettings, onOpenAgent, projectName }: Props) {
	const { workspaceId } = useParams<{ workspaceId: string }>();
	const { state, connected, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId!);

	useEffect(() => {
		onConnectedChange(connected);
	}, [connected, onConnectedChange]);

	useEffect(() => {
		if (state) {
			onAutonomousChange(state.autonomousModeEnabled);
		}
	}, [state, onAutonomousChange]);

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

	return (
		<KanbanBoard
			state={state}
			onRefresh={refetch}
			onDeleteCard={optimisticDeleteCard}
			onOpenSettings={onOpenSettings}
			onOpenAgent={onOpenAgent}
			projectName={projectName}
		/>
	);
}
