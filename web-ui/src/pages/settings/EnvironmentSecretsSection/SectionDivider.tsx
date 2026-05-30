export function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold shrink-0 text-[#f0f0f5]">{title}</span>
			<div className="flex-1 h-px bg-[#1a1a1f]" />
		</div>
	);
}
