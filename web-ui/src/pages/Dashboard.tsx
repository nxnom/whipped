import { Button, Switch, toast } from "@geckoui/geckoui";
import { Square, Terminal } from "lucide-react";
import { useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	workspaceId: string;
}

const ACTIVE_STATES = new Set(["running", "review_in_progress", "awaiting_review"]);

export function DashboardPage({ workspaceId }: Props) {
	const { state, refetch } = useWorkspaceState(workspaceId);
	const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
	const [togglingMode, setTogglingMode] = useState(false);

	if (!state) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>;
	}

	const activeSessions = Object.entries(state.sessions).filter(([, s]) => ACTIVE_STATES.has(s.state));

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
						Agents automatically pick up <span className="text-emerald-400">Ready for Dev</span> and{" "}
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
							Move tasks to <span className="text-emerald-400">Ready for Dev</span> and enable autonomous mode
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{activeSessions.map(([taskId, session]) => {
							const card = state.board.cards[taskId];
							if (!card) return null;
							const isExpanded = expandedTaskId === taskId;

							return (
								<div key={taskId} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
									<div
										className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/50"
										onClick={() => setExpandedTaskId(isExpanded ? null : taskId)}
									>
										<div className="flex items-center gap-3">
											<span className={`size-2 rounded-full ${
												session.state === "running" ? "bg-blue-400 animate-pulse" :
												session.state === "review_in_progress" ? "bg-purple-400 animate-pulse" :
												"bg-yellow-400"
											}`} />
											<div>
												<p className="text-sm text-gray-100">{card.title}</p>
												<p className="text-xs text-gray-500 mt-0.5">
													{session.agentId} · {session.state.replace(/_/g, " ")}
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
												onClick={(e) => { e.stopPropagation(); setExpandedTaskId(isExpanded ? null : taskId); }}
												className={`transition-colors ${isExpanded ? "text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
												title="Toggle output"
											>
												<Terminal size={14} />
											</button>
										</div>
									</div>

									{isExpanded && (
										<div className="border-t border-gray-800">
											<TaskTerminal
												taskId={taskId}
												workspaceId={workspaceId}
												className="h-72 px-1"
											/>
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
