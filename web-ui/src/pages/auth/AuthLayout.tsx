import { Cpu } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
	title: string;
	subtitle: string;
	children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: Props) {
	return (
		<div className="dark min-h-screen flex items-center justify-center bg-[#050505] text-[#ededed]">
			<div className="w-[360px] flex flex-col gap-6 rounded-xl border border-[#2a2a2a] bg-[#0b0b0b] p-8">
				<div className="flex flex-col items-center gap-3">
					<div className="flex items-center justify-center w-14 h-14 rounded-full bg-[#ffffff10]">
						<Cpu size={28} className="text-[#ffffff]" />
					</div>
					<div className="flex flex-col items-center gap-1 text-center">
						<span className="text-[20px] font-semibold text-[#ededed]">{title}</span>
						<span className="text-[13px] text-[#5f6672]">{subtitle}</span>
					</div>
				</div>
				{children}
			</div>
		</div>
	);
}
