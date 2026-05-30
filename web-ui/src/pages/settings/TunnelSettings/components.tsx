import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { classNames } from "@/utils/classNames";

export function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px] text-[#a0a0c0]">{children}</span>;
}

export function CodeBlock({ children }: { children: string }) {
	return (
		<code className="block px-3 py-2 rounded font-mono text-[11px] bg-[#0c0c0f] border border-[#2a2a35] text-[#a0a0c0]">
			{children}
		</code>
	);
}

export function CopyBlock({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};
	return (
		<div className="flex items-center gap-2 px-3 py-2 rounded font-mono text-[11px] bg-[#0c0c0f] border border-[#2a2a35] text-[#a0a0c0]">
			<span className="flex-1 truncate">{value}</span>
			<button onClick={handleCopy} className="shrink-0 opacity-40 hover:opacity-80 transition-opacity text-[#c0c0d0]">
				{copied ? <Check size={12} /> : <Copy size={12} />}
			</button>
		</div>
	);
}

function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
	return (
		<div
			className={classNames(
				"shrink-0 flex items-center justify-center text-[11px] font-bold w-6 h-6 rounded-full border",
				done
					? "bg-[#1a3a1a] border-[#2a6a2a] text-[#4ade80]"
					: active
						? "bg-[#1a1a2e] border-[#3a3aff60] text-[#7c6aff]"
						: "bg-[#1a1a1f] border-[#2a2a35] text-[#4a4a5a]",
			)}
		>
			{done ? <Check size={12} /> : n}
		</div>
	);
}

export function StepRow({
	n,
	title,
	done,
	active,
	children,
}: {
	n: number;
	title: string;
	done: boolean;
	active: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex gap-4">
			<div className="flex flex-col items-center gap-1">
				<StepBadge n={n} done={done} active={active} />
				{children && <div className="flex-1 w-px bg-[#2a2a35] min-h-2" />}
			</div>
			<div className="flex flex-col gap-3 flex-1 pb-6">
				<p
					className={classNames(
						"text-[13px] font-medium leading-none pt-0.5",
						active || done ? "text-[#f0f0f5]" : "text-[#4a4a5a]",
					)}
				>
					{title}
				</p>
				{children}
			</div>
		</div>
	);
}
