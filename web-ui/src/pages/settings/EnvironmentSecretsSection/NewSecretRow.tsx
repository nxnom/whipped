import { Plus } from "lucide-react";
import { useState } from "react";

export function NewSecretRow({ onAdd }: { onAdd: (key: string) => void }) {
	const [key, setKey] = useState("");
	const submit = () => {
		const k = key.trim();
		if (!k) return;
		onAdd(k);
		setKey("");
	};
	return (
		<div className="flex items-center gap-3">
			<input
				autoFocus
				value={key}
				onChange={(e) => setKey(e.target.value)}
				onKeyDown={(e) => e.key === "Enter" && submit()}
				placeholder="SECRET_KEY"
				className="w-[200px] shrink-0 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px] text-[#c0c0d0] font-mono text-[12px] outline-none"
			/>
			<div className="flex-1 bg-[#0c0c0f] border border-[#2a2a35] rounded-md px-3 py-[9px] text-[#4a4a5a] font-mono text-[12px]">
				value after save
			</div>
			<button onClick={submit} className="shrink-0 hover:opacity-70 transition-opacity text-[#7c6aff]">
				<Plus size={14} />
			</button>
		</div>
	);
}
