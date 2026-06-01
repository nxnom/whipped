import { forwardRef, useRef } from "react";
import { classNames } from "@/utils/classNames";

// A textarea that highlights `[Attachment #N]` tokens with a subtle chip
// background, so attachment references are easy to spot. Works by layering a
// styled backdrop behind a transparent-text textarea (the only way to "style"
// text inside a textarea). The backdrop and textarea share identical box
// metrics via `metricsClassName` so glyphs line up exactly.

const SPLIT_RE = /(\[Attachment #\d+\])/g;
const TOKEN_RE = /^\[Attachment #\d+\]$/;

interface TokenTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
	value: string;
	/** Classes applied to BOTH the textarea and the backdrop (font, padding, leading). */
	metricsClassName?: string;
	/** Wrapper class. */
	className?: string;
}

export const TokenTextarea = forwardRef<HTMLTextAreaElement, TokenTextareaProps>(function TokenTextarea(
	{ value, metricsClassName, className, onScroll, style, ...rest },
	ref,
) {
	const backdropRef = useRef<HTMLDivElement>(null);
	const parts = value.split(SPLIT_RE);

	return (
		<div className={classNames("relative", className)}>
			<div
				ref={backdropRef}
				aria-hidden
				className={classNames(
					"pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words",
					metricsClassName,
				)}
			>
				{parts.map((p, i) =>
					TOKEN_RE.test(p) ? (
						<mark
							key={i}
							className="rounded-[3px] bg-[#2a2a38] text-[#c4c4d4]"
							style={{ boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
						>
							{p}
						</mark>
					) : (
						<span key={i}>{p}</span>
					),
				)}
				{value.endsWith("\n") ? "\n" : ""}
			</div>
			<textarea
				ref={ref}
				value={value}
				onScroll={(e) => {
					if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
					onScroll?.(e);
				}}
				className={classNames("relative block w-full resize-none bg-transparent outline-none", metricsClassName)}
				style={{ color: "transparent", caretColor: "#e5e7eb", ...style }}
				{...rest}
			/>
		</div>
	);
});
