import { Cpu } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
	title: string;
	subtitle: string;
	children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: Props) {
	return (
		<div className="dark min-h-screen flex items-center justify-center bg-[#0f0f10] text-gray-100">
			<div className="w-[360px] flex flex-col gap-6 rounded-xl border border-[#2a2a35] bg-[#141417] p-8">
				<div className="flex flex-col items-center gap-3">
					<div className="flex items-center justify-center w-14 h-14 rounded-full bg-[#7c6aff10]">
						<Cpu size={28} className="text-[#7c6aff]" />
					</div>
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-[20px] font-semibold text-[#f0f0f5]">{title}</span>
						<span className="text-[13px] text-[#60607a]">{subtitle}</span>
					</div>
				</div>
				{children}
			</div>
		</div>
	);
}
