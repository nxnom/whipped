import type { RuntimeProjectSecret } from "@runtime-contract";
import { Eye, EyeOff, Lock, X } from "lucide-react";
import { useState } from "react";
import { classNames } from "@/utils/classNames";

export function SecretRow({
	secret,
	isBuiltin,
	onUpdate,
	onRemove,
}: {
	secret: RuntimeProjectSecret;
	isBuiltin: boolean;
	onUpdate: (value: string) => void;
	onRemove: () => void;
}) {
	const [revealed, setRevealed] = useState(false);

	return (
		<div className="flex items-center gap-3">
			{/* Key */}
			<div className="shrink-0 flex items-center w-[200px] bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px]">
				<span className="text-[12px] font-mono truncate text-[#c0c0d0]">{secret.key}</span>
			</div>

			{/* Value */}
			<div className="flex-1 flex items-center gap-2 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px]">
				<input
					type={revealed ? "text" : "password"}
					value={secret.value}
					onChange={(e) => onUpdate(e.target.value)}
					placeholder="not set"
					className={classNames(
						"flex-1 bg-transparent text-[12px] font-mono focus:outline-none min-w-0",
						revealed ? "text-[#c0c0d0]" : "text-[#60607a]",
					)}
				/>
				<button
					type="button"
					onClick={() => setRevealed((v) => !v)}
					className="shrink-0 hover:opacity-70 transition-opacity text-[#60607a]"
				>
					{revealed ? <EyeOff size={14} /> : <Eye size={14} />}
				</button>
			</div>

			{/* Badge or remove */}
			{isBuiltin ? (
				<span className="shrink-0 text-[#3b82f6]">
					<Lock size={14} />
				</span>
			) : (
				<button onClick={onRemove} className="shrink-0 hover:opacity-70 transition-opacity text-[#60607a]">
					<X size={14} />
				</button>
			)}
		</div>
	);
}
