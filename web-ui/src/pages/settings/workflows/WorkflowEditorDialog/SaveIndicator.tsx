import { Check, Loader2 } from "lucide-react";
import type { SaveStatus } from "./types";

export function SaveIndicator({ status }: { status: SaveStatus }) {
	if (status === "saving" || status === "loading") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-[#60607a]">
				<Loader2 size={10} className="animate-spin" />
				{status === "loading" ? "Loading…" : "Saving…"}
			</span>
		);
	}
	if (status === "saved") {
		return (
			<span className="flex items-center gap-1 text-[10px] text-emerald-500">
				<Check size={10} />
				Saved
			</span>
		);
	}
	if (status === "unsaved") {
		return <span className="text-[10px] text-amber-500">Unsaved…</span>;
	}
	if (status === "error") {
		return <span className="text-[10px] text-red-400">Save failed</span>;
	}
	return null;
}
