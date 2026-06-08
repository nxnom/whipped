import { X } from "lucide-react";
import { useState } from "react";
import { useUpdateAvailable } from "@/stores/board-store";

const DISMISSED_KEY = (v: string) => `whipped:update-dismissed:${v}`;

export function UpdateBanner() {
	const update = useUpdateAvailable();
	const [dismissed, setDismissed] = useState(() =>
		update ? localStorage.getItem(DISMISSED_KEY(update.latestVersion)) === "1" : false,
	);

	if (!update || dismissed) return null;

	const copy = () => {
		navigator.clipboard.writeText("npm install -g whipped").catch(() => {});
	};

	const dismiss = () => {
		localStorage.setItem(DISMISSED_KEY(update.latestVersion), "1");
		setDismissed(true);
	};

	return (
		<div className="flex items-center gap-3 shrink-0 px-4 py-2 bg-[#16160a] border-b border-[#3a3a15] text-[#c8b866]">
			<span className="text-[12px]">Update available — v{update.latestVersion} is out.</span>
			<button
				onClick={copy}
				className="text-[11px] font-mono px-2 py-0.5 rounded border border-[#3a3a15] bg-[#1e1e0e] hover:bg-[#252510] transition-colors"
			>
				npm install -g whipped
			</button>
			<span className="text-[11px] text-[#7a7a40]">
				then run <code className="font-mono">whipped restart</code>
			</span>
			<button onClick={dismiss} className="ml-auto text-[#7a7a40] hover:text-[#c8b866] transition-colors">
				<X size={13} />
			</button>
		</div>
	);
}
