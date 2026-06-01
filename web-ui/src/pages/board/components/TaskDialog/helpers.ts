import type { PendingImage } from "./types";

export async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
	const { uploadAttachmentFile } = await import("@/runtime/attachments");
	const results = [];
	for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
	return results;
}
