import { Button } from "@geckoui/geckoui";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { classNames } from "@/utils/classNames";
import type { PendingComment } from "./types";

export type ReviewType = "comment" | "request_changes";

interface SubmitReviewDropdownProps {
	pendingComments: PendingComment[];
	onSubmit: (args: { reviewType: ReviewType; overallFeedback: string }) => Promise<void>;
}

export function SubmitReviewDropdown({ pendingComments, onSubmit }: SubmitReviewDropdownProps) {
	const [open, setOpen] = useState(false);
	const [reviewType, setReviewType] = useState<ReviewType>("comment");
	const [overallFeedback, setOverallFeedback] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const reviewHasContent = overallFeedback.trim().length > 0 || pendingComments.length > 0;

	const handleSubmit = async () => {
		if (!reviewHasContent) return;
		setSubmitting(true);
		try {
			await onSubmit({ reviewType, overallFeedback: overallFeedback.trim() });
			setOverallFeedback("");
			setOpen(false);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={() => setOpen((v) => !v)}
				className={classNames(
					"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
					open
						? "bg-[#22c55e] text-white"
						: "bg-[#22c55e]/20 hover:bg-[#22c55e] border border-[#22c55e]/40 text-[#22c55e] hover:text-white",
					pendingComments.length > 0 ? "ring-1 ring-[#22c55e]/50" : "",
				)}
			>
				Submit review
				{pendingComments.length > 0 && (
					<span className="bg-[#22c55e] text-white text-[9px] rounded-full px-1.5 py-0 font-bold">
						{pendingComments.length}
					</span>
				)}
				<ChevronDown size={10} />
			</button>

			{open && (
				<div className="absolute top-full right-0 mt-1.5 z-50 w-[400px] font-sans bg-[#0b0b0b] border border-[#2a2a2a] rounded-lg shadow-2xl overflow-hidden">
					{/* Dropdown header */}
					<div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
						<span className="text-sm font-semibold text-[#ededed]">Finish your review</span>
						<button
							onClick={() => setOpen(false)}
							className="text-[#5f6672] hover:text-[#ededed] transition-colors p-0.5 rounded"
						>
							<X size={14} />
						</button>
					</div>

					<div className="p-4 space-y-3">
						{/* Pending inline comments summary */}
						{pendingComments.length > 0 && (
							<div className="bg-[#161616] border border-[#2a2a2a] rounded-lg px-3 py-2">
								<p className="text-xs text-[#8a8f98]">
									<span className="font-semibold text-[#ededed]">{pendingComments.length}</span> pending inline comment
									{pendingComments.length !== 1 ? "s" : ""} staged
								</p>
								<div className="mt-1.5 space-y-0.5 max-h-16 overflow-y-auto">
									{pendingComments.map((c) => (
										<div key={c.id} className="flex items-start gap-1.5 text-[11px]">
											<span className="text-[#5f6672] font-mono shrink-0">
												{c.file}
												{c.lineNum !== null ? `:${c.lineNum}` : ""}
											</span>
											<span className="text-[#8a8f98] truncate">— {c.text}</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Feedback textarea */}
						<div className="rounded-lg border border-[#2a2a2a] bg-whip-bg focus-within:border-[#3a3a3a] transition-colors">
							<textarea
								autoFocus
								value={overallFeedback}
								onChange={(e) => setOverallFeedback(e.target.value)}
								placeholder="Leave a comment…"
								rows={4}
								className="w-full bg-transparent text-sm text-[#ededed] px-3 pt-3 pb-2 resize-none outline-none placeholder-[#5f6672]"
							/>
						</div>

						{/* Review type */}
						<div className="border border-[#2a2a2a] rounded-lg divide-y divide-[#2a2a2a] overflow-hidden">
							<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#161616] transition-colors">
								<input
									type="radio"
									name="review-type"
									value="comment"
									checked={reviewType === "comment"}
									onChange={() => setReviewType("comment")}
									className="mt-0.5 accent-[#ededed] shrink-0"
								/>
								<div>
									<p className="text-xs font-semibold text-[#ededed]">Comment</p>
									<p className="text-[11px] text-[#8a8f98] mt-0.5">
										Submit general feedback without reopening the task.
									</p>
								</div>
							</label>
							<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#161616] transition-colors">
								<input
									type="radio"
									name="review-type"
									value="request_changes"
									checked={reviewType === "request_changes"}
									onChange={() => setReviewType("request_changes")}
									className="mt-0.5 accent-[#ededed] shrink-0"
								/>
								<div>
									<p className="text-xs font-semibold text-[#ededed]">Request changes</p>
									<p className="text-[11px] text-[#8a8f98] mt-0.5">Submit feedback and reopen the task for fixes.</p>
								</div>
							</label>
						</div>
					</div>

					{/* Dropdown footer */}
					<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2a2a2a] bg-[#0b0b0b]">
						<Button variant="outlined" size="sm" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button size="sm" disabled={submitting || !reviewHasContent} onClick={() => void handleSubmit()}>
							{submitting ? "Submitting…" : "Submit review"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
