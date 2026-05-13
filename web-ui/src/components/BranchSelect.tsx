import { ChevronDown, GitBranch, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface BranchSelectProps {
	branches: string[];
	value: string;
	onChange: (branch: string) => void;
	placeholder?: string;
}

export function BranchSelect({ branches, value, onChange, placeholder = "Select branch" }: BranchSelectProps) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()));

	useEffect(() => {
		if (open) {
			setFilter("");
			setTimeout(() => inputRef.current?.focus(), 0);
		}
	}, [open]);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="w-full flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-left hover:border-gray-600 transition-colors focus:outline-none focus:border-blue-500"
			>
				<GitBranch size={13} className="text-gray-500 shrink-0" />
				<span className={`flex-1 truncate text-sm ${value ? "text-gray-100" : "text-gray-500"}`}>
					{value || placeholder}
				</span>
				<ChevronDown size={13} className={`text-gray-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>

			{open && (
				<div className="absolute z-50 mt-1 w-full min-w-[200px] bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
					<div className="p-2 border-b border-gray-800">
						<div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800 rounded-md">
							<Search size={12} className="text-gray-500 shrink-0" />
							<input
								ref={inputRef}
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								placeholder="Filter branches..."
								className="flex-1 bg-transparent text-xs text-gray-200 placeholder-gray-500 outline-none"
							/>
						</div>
					</div>
					<div className="max-h-52 overflow-y-auto py-1">
						{filtered.length === 0 ? (
							<div className="px-3 py-2.5 text-xs text-gray-500">No branches found</div>
						) : (
							filtered.map((b) => (
								<button
									key={b}
									type="button"
									onClick={() => {
										onChange(b);
										setOpen(false);
									}}
									className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-gray-800 transition-colors cursor-pointer ${b === value ? "text-blue-400 bg-blue-400/5" : "text-gray-200"}`}
								>
									<GitBranch size={11} className="shrink-0 text-gray-600" />
									{b}
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
