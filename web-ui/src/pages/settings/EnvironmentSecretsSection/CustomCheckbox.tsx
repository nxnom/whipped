import { classNames } from "@/utils/classNames";

export function CustomCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			onClick={() => onChange(!checked)}
			className={classNames(
				"shrink-0 flex items-center justify-center transition-colors w-4 h-4 rounded-[3px]",
				checked ? "bg-[#7c6aff] border-0" : "bg-transparent border border-[#2a2a35]",
			)}
		>
			{checked && (
				<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
					<path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			)}
		</button>
	);
}
