import { Cpu } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
	title: string;
	subtitle: string;
	children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: Props) {
	return (
		<div className="min-h-screen flex items-center justify-center bg-whip-bg text-whip-text">
			<div className="w-[360px] flex flex-col gap-6 rounded-xl border border-whip-border bg-whip-surface p-8">
				<div className="flex flex-col items-center gap-3">
					<div className="flex items-center justify-center w-14 h-14 rounded-full bg-whip-accent/10">
						<Cpu size={28} className="text-whip-accent" />
					</div>
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-[20px] font-semibold text-whip-text">{title}</span>
						<span className="text-[13px] text-whip-faint">{subtitle}</span>
					</div>
				</div>
				{children}
			</div>
		</div>
	);
}
