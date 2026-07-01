import type { RuntimeReviewComment } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import { MODEL_STYLE } from "./constants";

export function AgentBadge({ comment }: { comment: RuntimeReviewComment }) {
	const { actor, status } = comment;

	if (actor.type === "external") {
		const label = (actor.source ?? "External").charAt(0).toUpperCase() + (actor.source ?? "External").slice(1);
		return (
			<span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium text-[#8a8f98] bg-[#2a2a2a]/50">
				{label}
			</span>
		);
	}
	if (actor.type === "human") return null;

	// AI actor — color by model so the same model always looks the same
	const className = MODEL_STYLE[actor.id] ?? "text-[#8a8f98] bg-[#2a2a2a]/50";
	return (
		<span
			className={classNames("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium", className)}
		>
			{actor.id}
			{status === "pass" && <span className="text-[#22c55e]">✓</span>}
			{status === "fail" && <span className="text-[#ff3b4d]">✗</span>}
			{status === "warning" && <span className="text-[#eab308]">⚠</span>}
			{status === "skipped" && <span className="text-[#8a8f98]">—</span>}
		</span>
	);
}
