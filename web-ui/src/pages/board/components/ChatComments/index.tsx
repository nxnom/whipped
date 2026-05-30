import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { useEffect, useMemo, useRef } from "react";
import { CommentComposer } from "./CommentComposer";
import { CommentItem } from "./CommentItem";
import { isDifferentDay, isSameGroup } from "./helpers";
import type { CommentEntry } from "./types";

interface Props {
	card: RuntimeBoardCard;
	workspaceId: string;
	allCards?: Record<string, RuntimeBoardCard>;
	workflowSlots?: WorkflowSlot[];
	onRefresh: () => void;
}

export function ChatComments({ card, workspaceId, allCards, workflowSlots, onRefresh }: Props) {
	const bottomRef = useRef<HTMLDivElement>(null);
	const isStory = card.type === "story";

	const commentEntries: CommentEntry[] = useMemo(() => {
		if (!isStory) {
			return (card.reviewComments ?? []).map((c) => ({ comment: c }));
		}
		const storyEntries: CommentEntry[] = (card.reviewComments ?? [])
			.filter((c) => c.type !== "dev")
			.map((c) => ({ comment: c }));
		const subtaskEntries: CommentEntry[] = (card.dependsOn ?? []).flatMap((depId) => {
			const dep = allCards?.[depId];
			if (!dep) return [];
			return (dep.reviewComments ?? []).map((c) => ({
				comment: c,
				sourceCardTitle: dep.description?.split("\n")[0] ?? dep.id,
			}));
		});
		return [...storyEntries, ...subtaskEntries].sort((a, b) => a.comment.createdAt - b.comment.createdAt);
	}, [isStory, card.reviewComments, card.dependsOn, allCards]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "instant" });
	}, [commentEntries.length]);

	return (
		<div className="flex-1 min-h-0 flex flex-col bg-[#0a0a0e]">
			{/* Messages */}
			<div className="flex-1 overflow-y-auto py-4">
				{commentEntries.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<p className="text-sm text-[#4a4a5a]">No comments yet</p>
					</div>
				) : (
					<>
						{commentEntries.map((entry, i) => {
							const prev = commentEntries[i - 1];
							const showDate =
								i === 0 || (prev != null && isDifferentDay(prev.comment.createdAt, entry.comment.createdAt));
							const showHeader = i === 0 || (prev != null && !isSameGroup(prev, entry));
							return (
								<CommentItem
									key={i}
									entry={entry}
									showDate={showDate}
									showHeader={showHeader}
									workflowSlots={workflowSlots}
								/>
							);
						})}
						<div ref={bottomRef} />
					</>
				)}
			</div>

			<CommentComposer card={card} workspaceId={workspaceId} onRefresh={onRefresh} />
		</div>
	);
}
