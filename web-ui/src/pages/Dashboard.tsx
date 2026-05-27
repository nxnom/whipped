import { Button, Switch, toast } from "@geckoui/geckoui";
import { Square, Terminal } from "lucide-react";
import { useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	workspaceId: string;
}

export function DashboardPage({ workspaceId }: Props) {
	const { state, refetch } = useWorkspaceState(workspaceId);
	const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
	const [togglingMode, setTogglingMode] = useState(false);

	if (!state) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>;
	}

	const activeSessions = Object.entries(state.board.cards).filter(([, card]) =>
		card.terminalSessions?.some((ts) => !ts.endedAt),
	);

	const handleToggleAutonomous = async () => {
		setTogglingMode(true);
		try {
			await trpc.workspace.setAutonomousMode.mutate({ workspaceId, enabled: !state.autonomousModeEnabled });
			refetch();
			toast.success(state.autonomousModeEnabled ? "Autonomous mode off" : "Autonomous mode on");
		} catch {
			toast.error("Failed to toggle autonomous mode");
		} finally {
			setTogglingMode(false);
		}
	};

	return (
		<div className="flex-1 overflow-y-auto p-4 space-y-4">
			{/* Autonomous mode toggle */}
			<div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
				<div>
					<h3 className="text-sm font-semibold text-gray-100">Autonomous Mode</h3>
					<p className="text-xs text-gray-400 mt-0.5">
						Agents automatically pick up <span className="text-emerald-400">Ready</span> and{" "}
						<span className="text-orange-400">Reopened</span> tasks
					</p>
				</div>
				<label className="flex items-center gap-2 cursor-pointer">
					<Switch checked={state.autonomousModeEnabled} onChange={handleToggleAutonomous} disabled={togglingMode} />
				</label>
			</div>

			{/* Active tasks */}
			<div>
				<h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
					Active Tasks ({activeSessions.length})
				</h3>

				{activeSessions.length === 0 ? (
					<div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
						<p className="text-sm text-gray-500">No active tasks</p>
						<p className="text-xs text-gray-600 mt-1">
							Mark tasks as <span className="text-emerald-400">Ready</span> and enable autonomous mode
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{activeSessions.map(([taskId, card]) => {
							if (!card) return null;
							const isExpanded = expandedTaskId === taskId;

							return (
								<div key={taskId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
									<div
										className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/50"
										onClick={() => setExpandedTaskId(isExpanded ? null : taskId)}
									>
										<div className="flex items-center gap-3">
											<span className="size-2 rounded-full bg-blue-400 animate-pulse" />
											<div>
												<p className="text-sm text-gray-100">{card.description?.split("\n")[0] ?? card.id}</p>
												<p className="text-xs text-gray-500 mt-0.5">
													{card.terminalSessions?.find((ts) => !ts.endedAt)?.agentId} · running
												</p>
											</div>
										</div>
										<div className="flex items-center gap-2">
											<Button
												variant="outlined"
												size="xs"
												onClick={async (e) => {
													e.stopPropagation();
													try {
														await trpc.cards.stopAgent.mutate({ workspaceId, cardId: taskId });
														refetch();
													} catch {
														toast.error("Failed to stop agent");
													}
												}}
											>
												<Square size={10} className="mr-1" /> Stop
											</Button>
											<button
												onClick={(e) => {
													e.stopPropagation();
													setExpandedTaskId(isExpanded ? null : taskId);
												}}
												className={`transition-colors ${isExpanded ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
												title="Toggle output"
											>
												<Terminal size={14} />
											</button>
										</div>
									</div>

									{isExpanded && (
										<div className="border-t border-gray-800">
											<TaskTerminal taskId={taskId} workspaceId={workspaceId} className="h-72 px-1" />
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
