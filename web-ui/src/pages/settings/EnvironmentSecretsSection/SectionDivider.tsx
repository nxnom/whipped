export function SectionDivider({ title }: { title: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[15px] font-semibold shrink-0 text-whip-text">{title}</span>
			<div className="flex-1 h-px bg-whip-panel" />
		</div>
	);
}
