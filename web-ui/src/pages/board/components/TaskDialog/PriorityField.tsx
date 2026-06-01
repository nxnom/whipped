import { Controller, useFormContext } from "react-hook-form";
import { PRIORITY_OPTIONS } from "./constants";

export function PriorityField({ name }: { name: string }) {
	const { control } = useFormContext();
	return (
		<Controller
			control={control}
			name={name}
			render={({ field }) => (
				<div className="flex flex-wrap gap-1.5">
					{PRIORITY_OPTIONS.map((opt) => {
						const active = field.value === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => field.onChange(active ? "" : opt.value)}
								className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] border transition-colors"
								style={
									active
										? { background: opt.bg, color: opt.text, borderColor: opt.border, fontWeight: 500 }
										: { background: "#1a1a1f", color: "#60607a", borderColor: "#2a2a35" }
								}
							>
								<span className="size-1.5 rounded-full shrink-0" style={{ background: opt.dot }} />
								{opt.label}
							</button>
						);
					})}
				</div>
			)}
		/>
	);
}
