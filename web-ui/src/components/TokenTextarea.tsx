import { forwardRef, useRef } from "react";
import { classNames } from "@/utils/classNames";

// A textarea that highlights `[Attachment #N]` tokens with a subtle chip
// background, so attachment references are easy to spot. Works by layering a
// styled backdrop behind a transparent-text textarea (the only way to "style"
// text inside a textarea). The backdrop and textarea share identical box
// metrics via `metricsClassName` so glyphs line up exactly.

const SPLIT_RE = /(\[Attachment #\d+\])/g;
const SPLIT_RE_REFS = /(\[Attachment #\d+\]|#\d+)/g;
const TOKEN_RE = /^\[Attachment #\d+\]$/;
const REF_RE = /^#(\d+)$/;

interface TokenTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
	value: string;
	/** Classes applied to BOTH the textarea and the backdrop (font, padding, leading). */
	metricsClassName?: string;
	/** Wrapper class. */
	className?: string;
	/** When set, `#N` references are colour-chipped using the returned colour
	 *  (undefined leaves the reference plain). Used for visual-comment element refs. */
	refColorOf?: (n: number) => string | undefined;
}

export const TokenTextarea = forwardRef<HTMLTextAreaElement, TokenTextareaProps>(function TokenTextarea(
	{ value, metricsClassName, className, onScroll, style, refColorOf, ...rest },
	ref,
) {
	const backdropRef = useRef<HTMLDivElement>(null);
	const parts = value.split(refColorOf ? SPLIT_RE_REFS : SPLIT_RE);

	const renderPart = (p: string, i: number) => {
		if (TOKEN_RE.test(p)) {
			return (
				<mark
					key={i}
					className="rounded-[3px] bg-[#2a2a2a] text-[#c4c4d4]"
					style={{ boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}
				>
					{p}
				</mark>
			);
		}
		const refMatch = refColorOf ? REF_RE.exec(p) : null;
		const refColor = refMatch ? refColorOf?.(Number(refMatch[1])) : undefined;
		if (refColor) {
			return (
				<mark
					key={i}
					className="rounded-[3px] font-semibold"
					style={{
						backgroundColor: refColor,
						color: "#111111",
						boxDecorationBreak: "clone",
						WebkitBoxDecorationBreak: "clone",
					}}
				>
					{p}
				</mark>
			);
		}
		return <span key={i}>{p}</span>;
	};

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
				{parts.map(renderPart)}
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
				style={{ color: "transparent", caretColor: "#ededed", ...style }}
				{...rest}
			/>
		</div>
	);
});
