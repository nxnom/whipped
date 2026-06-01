import type { KeyboardEvent } from "react";

// Inline `[Attachment #N]` references let an agent tell uploaded files apart and
// see where each is meant to apply. N is 1-based and matches the attachment's
// position in the ordered pending list. Shared by the comment composer and the
// create-task description.

// The text is the source of truth: which attachments are "live" is whatever
// `[Attachment #N]` tokens remain, so any deletion (mid-token, select-all, cut)
// drops them and native undo restores them — no programmatic text rewrites.

/**
 * Treats `[Attachment #N]` as a single atomic unit (like one letter): a
 * Backspace/Delete that touches it removes the whole token, and typing a
 * character while the caret is inside it (or a selection overlaps it) replaces
 * the whole token with that character. Returns the resulting text + caret, or
 * null when no token is affected — so ordinary edits fall through to native
 * handling and keep their undo history. Calls preventDefault on a hit.
 */
export function atomicTokenEdit(
	e: KeyboardEvent<HTMLTextAreaElement>,
): { start: number; end: number; insert: string } | null {
	const isBackspace = e.key === "Backspace";
	const isDelete = e.key === "Delete";
	// A printable keystroke — a single char with no command/control modifier.
	const isType = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
	if (!isBackspace && !isDelete && !isType) return null;

	const value = e.currentTarget.value;
	let start = e.currentTarget.selectionStart;
	let end = e.currentTarget.selectionEnd;
	if (start === end) {
		if (isBackspace) {
			if (start === 0) return null;
			start -= 1;
		} else if (isDelete) {
			if (end === value.length) return null;
			end += 1;
		}
		// Typing with a collapsed caret only matters when it sits *inside* a token.
	}

	const hit = [...value.matchAll(/\[Attachment #\d+\]/g)]
		.map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
		.filter((t) => t.start < end && t.end > start);
	if (hit.length === 0) return null;

	e.preventDefault();
	return {
		start: Math.min(start, ...hit.map((t) => t.start)),
		end: Math.max(end, ...hit.map((t) => t.end)),
		insert: isType ? e.key : "",
	};
}

/**
 * Apply a programmatic edit to a textarea *through the native editing pipeline*
 * (execCommand) so it lands on the browser's undo stack — Ctrl/Cmd+Z keeps
 * working. Returns false if execCommand is unavailable so callers can fall back
 * to a controlled-value update.
 */
export function applyTextareaEdit(ta: HTMLTextAreaElement, start: number, end: number, insert: string): boolean {
	ta.focus();
	ta.setSelectionRange(start, end);
	return insert ? document.execCommand("insertText", false, insert) : document.execCommand("delete");
}

/** Ordered, unique attachment numbers referenced in the text. */
export function parseAttachmentTokenNumbers(text: string): number[] {
	const seen = new Set<number>();
	const order: number[] = [];
	for (const m of text.matchAll(/\[Attachment #(\d+)\]/g)) {
		const n = Number(m[1]);
		if (!seen.has(n)) {
			seen.add(n);
			order.push(n);
		}
	}
	return order;
}

/**
 * Renumber referenced tokens to a contiguous 1..k by appearance order; returns
 * the new text plus the original numbers in that order, so the caller can
 * reorder its attachments to match. Run once on submit (tokens may be sparse
 * like #1 #3 mid-edit since we never renumber live).
 */
export function normalizeAttachmentTokens(text: string): { text: string; order: number[] } {
	const order = parseAttachmentTokenNumbers(text);
	const map = new Map(order.map((orig, i) => [orig, i + 1]));
	const next = text.replace(/\[Attachment #(\d+)\]/g, (m, x) => {
		const to = map.get(Number(x));
		return to == null ? m : `[Attachment #${to}]`;
	});
	return { text: next, order };
}
