import type { RuntimeBoardCard } from "@runtime-contract";
import { Clock, ExternalLink, GitPullRequest } from "lucide-react";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	workspaceId: string;
}

export function HistoryPage({ workspaceId }: Props) {
	const { state } = useWorkspaceState(workspaceId);

	if (!state) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>;
	}

	const doneColumn = state.board.columns.find((c) => c.id === "done");
	const doneCards = (doneColumn?.taskIds ?? [])
		.map((id) => state.board.cards[id])
		.filter((c): c is RuntimeBoardCard => Boolean(c))
		.sort((a, b) => b.updatedAt - a.updatedAt);

	return (
		<div className="flex-1 overflow-y-auto p-4">
			<h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
				Completed ({doneCards.length})
			</h3>

			{doneCards.length === 0 ? (
				<div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
					<p className="text-sm text-gray-500">No completed tasks yet</p>
				</div>
			) : (
				<div className="space-y-2">
					{doneCards.map((card) => {
						const session = state.sessions[card.id];
						const duration =
							session?.completedAt && session?.startedAt
								? Math.round((session.completedAt - session.startedAt) / 1000 / 60)
								: null;

						return (
							<div key={card.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
								<div className="flex items-start justify-between gap-3">
									<div className="flex-1 min-w-0">
										<p className="text-sm text-gray-200 font-medium">{card.title}</p>
										{card.description && (
											<p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{card.description}</p>
										)}
									</div>

									<div className="flex items-center gap-2 shrink-0">
										{duration !== null && (
											<span className="flex items-center gap-1 text-xs text-gray-500">
												<Clock size={10} />
												{duration}m
											</span>
										)}
										{card.githubPrUrl && (
											<a
												href={card.githubPrUrl}
												target="_blank"
												rel="noreferrer"
												className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300"
											>
												<GitPullRequest size={12} />
												PR
												<ExternalLink size={10} />
											</a>
										)}
									</div>
								</div>

								<div className="mt-2 flex items-center gap-2">
									{card.agentId && (
										<span className="text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">{card.agentId}</span>
									)}
									{card.jiraKey && (
										<a
											href={card.jiraUrl}
											target="_blank"
											rel="noreferrer"
											className="text-xs text-blue-400 hover:underline"
										>
											{card.jiraKey}
										</a>
									)}
									<span className="text-xs text-gray-600 ml-auto">{new Date(card.updatedAt).toLocaleDateString()}</span>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
