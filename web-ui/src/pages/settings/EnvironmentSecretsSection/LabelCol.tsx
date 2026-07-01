export function LabelCol({ label, description }: { label: string; description?: string }) {
	return (
		<div className="flex flex-col gap-0.5 shrink-0 w-40">
			<span className="text-[13px] font-medium text-[#ededed]">{label}</span>
			{description && <span className="text-[11px] text-[#5f6672]">{description}</span>}
		</div>
	);
}
