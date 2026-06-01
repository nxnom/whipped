import type { SubtaskDraftForm } from "@runtime-validation/card";

export interface PendingImage {
	dataUrl: string | null;
	file: File;
	// Stable token number for `[Attachment #n]` references (main task/story
	// description only; subtask images don't use inline tokens).
	n?: number;
}

// A subtask draft as held in component state: the RHF-validated fields plus the
// File-backed pending images (which live outside zod validation).
export interface SubtaskDraft extends SubtaskDraftForm {
	pendingImages: PendingImage[];
}

export type Mode = "task" | "story";
