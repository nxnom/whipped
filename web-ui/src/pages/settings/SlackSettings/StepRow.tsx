import { Check } from "lucide-react";
import { classNames } from "@/utils/classNames";

export function StepBadge({ n, done, active }: { n: number; done: boolean; active: boolean }) {
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

export function Mono({ children }: { children: React.ReactNode }) {
	return <span className="font-mono text-[11px] text-[#a0a0c0]">{children}</span>;
}
