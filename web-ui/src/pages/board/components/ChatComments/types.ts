import type { RuntimeReviewComment } from "@runtime-contract";

export interface CommentEntry {
	comment: RuntimeReviewComment;
	sourceCardTitle?: string;
}

export interface PendingAttachment {
	dataUrl: string | null; // local preview for images; null for non-image files
	file: File;
	name: string;
}
