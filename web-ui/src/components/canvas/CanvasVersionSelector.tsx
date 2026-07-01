import { Menu, MenuItem, MenuTrigger } from "@geckoui/geckoui";
import { ChevronDown, FileText } from "lucide-react";
import { classNames } from "@/utils/classNames";
import type { CanvasDocument } from "./types";

export function CanvasVersionSelector({
	canvases,
	selectedVersion,
	onSelectVersion,
}: {
	canvases: CanvasDocument[];
	selectedVersion: number;
	onSelectVersion: (version: number) => void;
}) {
	if (canvases.length <= 1) return null;

	return (
		<Menu menuClassName="min-w-[180px] py-1">
			<MenuTrigger>
				{({ toggleMenu, open }) => (
					<button
						onClick={toggleMenu}
						className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161616] border border-[#2a2a2a] hover:border-[#3a3a3a] text-[#8a8f98] hover:text-[#ededed] text-[11px] transition-colors"
					>
						<FileText size={11} className="text-[#8a8f98]" />
						<span>v{selectedVersion}</span>
						<ChevronDown
							size={10}
							className={classNames("text-[#5f6672] transition-transform", open && "rotate-180")}
						/>
					</button>
				)}
			</MenuTrigger>
			{canvases.map((p) => (
				<MenuItem key={p.version} onClick={() => onSelectVersion(p.version)}>
					<div
						className={classNames(
							"flex items-center gap-2.5 text-[11px]",
							selectedVersion === p.version ? "text-[#ededed]" : "text-[#8a8f98]",
						)}
					>
						<span className="font-mono text-[#8b5cf6] w-8 shrink-0 text-left">v{p.version}</span>
						<span className="flex-1 text-left truncate">{new Date(p.createdAt).toLocaleTimeString()}</span>
					</div>
				</MenuItem>
			))}
		</Menu>
	);
}
