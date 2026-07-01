import type { CanvasBlock } from "@runtime-contract";
import { HtmlBlock } from "./HtmlBlock";
import { MarkdownBlock } from "./MarkdownBlock";
import { MermaidBlock } from "./MermaidBlock";
import { QuestionBlock, RequiredMark } from "./QuestionBlock";
import type { CanvasAnswers } from "./types";

export function CanvasBlockRenderer({
	block,
	answers,
	onAnswer,
	disabled,
}: {
	block: CanvasBlock;
	answers: CanvasAnswers;
	onAnswer: (name: string, value: string | string[]) => void;
	disabled?: boolean;
}) {
	switch (block.type) {
		case "markdown":
			return <MarkdownBlock body={block.body} />;
		case "html":
			return <HtmlBlock body={block.body} />;
		case "diagram":
			return <MermaidBlock id={block.id} source={block.source} caption={block.caption} />;
		case "question":
			return (
				<div className="flex flex-col gap-2">
					<span className="text-[13px] font-medium text-[#ededed]">
						{block.prompt} {block.input.kind !== "composite" && <RequiredMark required={block.input.required} />}
					</span>
					<QuestionBlock input={block.input} answers={answers} onAnswer={onAnswer} disabled={disabled} />
				</div>
			);
	}
}
