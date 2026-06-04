import type { RuntimeVisualComment } from "@runtime-contract";

export interface WhippedPayload {
	description: string;
	visualComment?: RuntimeVisualComment;
}

function b64decodeUtf8(b64: string): string {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

// The Whipped browser extension copies a text/html representation that hides a
// <span data-whipped-payload="<base64-json>">. When a paste carries it, recover
// the structured payload so we fill the visual context, not just plain text.
export function parseWhippedClipboard(html: string): WhippedPayload | null {
	if (!html) return null;
	const m = html.match(/data-whipped-payload="([^"]+)"/);
	if (!m?.[1]) return null;
	try {
		const data = JSON.parse(b64decodeUtf8(m[1]));
		if (typeof data?.description !== "string") return null;
		return { description: data.description, visualComment: data.visualComment };
	} catch {
		return null;
	}
}
