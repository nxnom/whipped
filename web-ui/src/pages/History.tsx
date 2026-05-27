import type { RuntimeBoardCard } from "@runtime-contract";
import { Clock, ExternalLink, GitPullRequest } from "lucide-react";
import { CardDetailPanel } from "@/components/kanban/CardDetailPanel";
import { useUrlParam } from "@/runtime/url-state";
import { useWorkspaceState } from "@/stores/board-store";

interface Props {
	workspaceId: string;
}

export function HistoryPage({ workspaceId }: Props) {
	const { state, refetch, optimisticDeleteCard } = useWorkspaceState(workspaceId);
	const [detailCardId, setDetailCardId] = useUrlParam("card");

	if (!state) {
		return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>;
	}

	const detailCard = detailCardId ? (state.board.cards[detailCardId] ?? null) : null;

	const doneColumn = state.board.columns.find((c) => c.id === "done");
	const doneCards = (doneColumn?.taskIds ?? [])
		.map((id) => state.board.cards[id])
		.filter((c): c is RuntimeBoardCard => Boolean(c))
		.sort((a, b) => b.updatedAt - a.updatedAt);

	return (
		<div className="flex-1 overflow-hidden flex flex-col relative">
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
							const lastDevTs = card.terminalSessions
								?.slice()
								.reverse()
								.find((ts) => ts.type === "dev");
							const lastTs = card.terminalSessions?.at(-1);
							const duration =
								lastDevTs?.startedAt && lastTs?.endedAt
									? Math.round((lastTs.endedAt - lastDevTs.startedAt) / 1000 / 60)
									: null;

							return (
								<div
									key={card.id}
									onClick={() => setDetailCardId(card.id)}
									className="bg-gray-900 border border-gray-800 rounded-xl p-3 cursor-pointer hover:border-gray-600 transition-colors"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="flex-1 min-w-0">
											<p className="text-sm text-gray-200 font-medium">{card.description?.split("\n")[0] ?? card.id}</p>
											{card.description && card.description.includes("\n") && (
												<p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{card.description.split("\n").slice(1).join("\n").trim()}</p>
											)}
										</div>

										<div className="flex items-center gap-2 shrink-0">
											{duration !== null && (
												<span className="flex items-center gap-1 text-xs text-gray-500">
													<Clock size={10} />
													{duration}m
												</span>
											)}
											{card.pr?.url && (
												<a
													href={card.pr?.url}
													target="_blank"
													rel="noreferrer"
													onClick={(e) => e.stopPropagation()}
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
												onClick={(e) => e.stopPropagation()}
												className="text-xs text-blue-400 hover:underline"
											>
												{card.jiraKey}
											</a>
										)}
										<span className="text-xs text-gray-600 ml-auto">
											{new Date(card.updatedAt).toLocaleDateString()}
										</span>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{detailCard && (
				<CardDetailPanel
					card={detailCard}
					workspaceId={workspaceId}
					onClose={() => setDetailCardId(null)}
					onRefresh={refetch}
					onDeleteCard={optimisticDeleteCard}
				/>
			)}
		</div>
	);
}
