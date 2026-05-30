import type { RuntimeReviewComment, WorkflowSlot } from "@runtime-contract";
import { TYPE_LABELS } from "./constants";
import type { CommentEntry } from "./types";

export function displayName(comment: RuntimeReviewComment, slots?: WorkflowSlot[]): string {
	const { actor, type } = comment;
	if (actor.type === "human" && actor.id === "human") return "You";
	if (actor.type === "external") return actor.id;
	// AI actor — use type label
	if (TYPE_LABELS[type]) return TYPE_LABELS[type]!;
	const slot = slots?.find((s) => s.id === type);
	if (slot) return slot.name;
	return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatDateLabel(ts: number): string {
	const d = new Date(ts);
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === today.toDateString()) return "Today";
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

export function isDifferentDay(a: number, b: number): boolean {
	return new Date(a).toDateString() !== new Date(b).toDateString();
}

export function isSameGroup(a: CommentEntry, b: CommentEntry): boolean {
	if (a.sourceCardTitle !== b.sourceCardTitle) return false;
	const keyA = `${a.comment.actor.id}|${a.comment.actor.type}|${a.comment.actor.source ?? ""}|${a.comment.type}`;
	const keyB = `${b.comment.actor.id}|${b.comment.actor.type}|${b.comment.actor.source ?? ""}|${b.comment.type}`;
	return keyA === keyB && b.comment.createdAt - a.comment.createdAt < 5 * 60 * 1000;
}
