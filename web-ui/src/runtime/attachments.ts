// Converts an absolute attachment path (stored in card data) to a serving URL.
// Path format: /.../.kanbom/attachments/{cardId}/{filename}
// URL format:  /api/attachments/{cardId}/{filename}
export function attachmentUrl(path: string): string {
	const parts = path.replace(/\\/g, "/").split("/");
	const filename = parts[parts.length - 1] ?? "";
	const cardId = parts[parts.length - 2] ?? "";
	return `/api/attachments/${cardId}/${filename}`;
}

// Uploads a File via raw HTTP (no base64). Returns the stored attachment record.
export async function uploadAttachmentFile(
	workspaceId: string,
	cardId: string,
	file: File,
): Promise<{ path: string; name: string; mimeType: string; type: string }> {
	const params = new URLSearchParams({ workspaceId, filename: file.name, mimeType: file.type });
	const res = await fetch(`/api/attachments/${encodeURIComponent(cardId)}?${params}`, {
		method: "POST",
		body: file,
		headers: { "Content-Type": file.type },
	});
	if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
	return res.json() as Promise<{ path: string; name: string; mimeType: string; type: string }>;
}
