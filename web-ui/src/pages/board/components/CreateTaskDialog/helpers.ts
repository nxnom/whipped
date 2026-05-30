import type { PendingImage } from "./types";

export async function uploadImages(workspaceId: string, cardId: string, images: PendingImage[]) {
	const { uploadAttachmentFile } = await import("@/runtime/attachments");
	const results = [];
	for (const img of images) results.push(await uploadAttachmentFile(workspaceId, cardId, img.file));
	return results;
}

export function addFilesFromClipboard(
	e: { clipboardData: DataTransfer; preventDefault(): void },
	setter: (fn: (prev: PendingImage[]) => PendingImage[]) => void,
) {
	const files = Array.from(e.clipboardData.files);
	if (!files.length) return;
	e.preventDefault();
	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const r = new FileReader();
			r.onload = (ev) => setter((p) => [...p, { dataUrl: ev.target?.result as string, file }]);
			r.readAsDataURL(file);
		} else {
			setter((p) => [...p, { dataUrl: null, file }]);
		}
	}
}
