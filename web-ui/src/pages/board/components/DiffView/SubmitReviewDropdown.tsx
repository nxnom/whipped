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
						? "bg-green-700 text-white"
						: "bg-green-800/60 hover:bg-green-700 border border-green-700/50 text-green-300 hover:text-white",
					pendingComments.length > 0 ? "ring-1 ring-green-500/50" : "",
				)}
			>
				Submit review
				{pendingComments.length > 0 && (
					<span className="bg-green-600 text-white text-[9px] rounded-full px-1.5 py-0 font-bold">
						{pendingComments.length}
					</span>
				)}
				<ChevronDown size={10} />
			</button>

			{open && (
				<div className="absolute top-full right-0 mt-1.5 z-50 w-[400px] font-sans bg-[#13131a] border border-[#2a2a38] rounded-lg shadow-2xl overflow-hidden">
					{/* Dropdown header */}
					<div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a38]">
						<span className="text-sm font-semibold text-gray-100">Finish your review</span>
						<button
							onClick={() => setOpen(false)}
							className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
						>
							<X size={14} />
						</button>
					</div>

					<div className="p-4 space-y-3">
						{/* Pending inline comments summary */}
						{pendingComments.length > 0 && (
							<div className="bg-[#1a1a24] border border-[#2a2a38] rounded-lg px-3 py-2">
								<p className="text-xs text-gray-400">
									<span className="font-semibold text-gray-200">{pendingComments.length}</span> pending inline comment
									{pendingComments.length !== 1 ? "s" : ""} staged
								</p>
								<div className="mt-1.5 space-y-0.5 max-h-16 overflow-y-auto">
									{pendingComments.map((c) => (
										<div key={c.id} className="flex items-start gap-1.5 text-[11px]">
											<span className="text-gray-600 font-mono shrink-0">
												{c.file}
												{c.lineNum !== null ? `:${c.lineNum}` : ""}
											</span>
											<span className="text-gray-500 truncate">— {c.text}</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Feedback textarea */}
						<div className="rounded-lg border border-[#2a2a38] bg-[#0d0d12] focus-within:border-[#3a3a50] transition-colors">
							<textarea
								autoFocus
								value={overallFeedback}
								onChange={(e) => setOverallFeedback(e.target.value)}
								placeholder="Leave a comment…"
								rows={4}
								className="w-full bg-transparent text-sm text-gray-200 px-3 pt-3 pb-2 resize-none outline-none placeholder-gray-600"
							/>
						</div>

						{/* Review type */}
						<div className="border border-[#2a2a38] rounded-lg divide-y divide-[#2a2a38] overflow-hidden">
							<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#1a1a24] transition-colors">
								<input
									type="radio"
									name="review-type"
									value="comment"
									checked={reviewType === "comment"}
									onChange={() => setReviewType("comment")}
									className="mt-0.5 accent-blue-500 shrink-0"
								/>
								<div>
									<p className="text-xs font-semibold text-gray-200">Comment</p>
									<p className="text-[11px] text-gray-500 mt-0.5">
										Submit general feedback without reopening the task.
									</p>
								</div>
							</label>
							<label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#1a1a24] transition-colors">
								<input
									type="radio"
									name="review-type"
									value="request_changes"
									checked={reviewType === "request_changes"}
									onChange={() => setReviewType("request_changes")}
									className="mt-0.5 accent-blue-500 shrink-0"
								/>
								<div>
									<p className="text-xs font-semibold text-gray-200">Request changes</p>
									<p className="text-[11px] text-gray-500 mt-0.5">Submit feedback and reopen the task for fixes.</p>
								</div>
							</label>
						</div>
					</div>

					{/* Dropdown footer */}
					<div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#2a2a38] bg-[#0f0f16]">
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
