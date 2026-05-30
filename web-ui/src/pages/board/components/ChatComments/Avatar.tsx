import type { RuntimeReviewComment } from "@runtime-contract";
import { useState } from "react";

export function Avatar({ comment }: { comment: RuntimeReviewComment }) {
	const [err, setErr] = useState(false);
	const { actor, type } = comment;

	if (actor.type === "human" || actor.type === "external") {
		const initials = actor.id.slice(0, 2).toUpperCase();
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#2a2a38] text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{initials}
			</div>
		);
	}

	const seed = `${type}-${actor.id}`;

	if (err) {
		return (
			<div className="w-8 h-8 rounded-full flex items-center justify-center bg-[#2a2a38] text-[11px] font-bold text-gray-300 shrink-0 select-none">
				{actor.id.slice(0, 2).toUpperCase()}
			</div>
		);
	}

	return (
		<img
			src={`https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`}
			alt={actor.id}
			className="w-8 h-8 rounded-full shrink-0 bg-[#1a1a24]"
			onError={() => setErr(true)}
			loading="lazy"
		/>
	);
}
