import type { PlanBlock } from "@runtime-contract";
import { HtmlBlock } from "./HtmlBlock";
import { MarkdownBlock } from "./MarkdownBlock";
import { MermaidBlock } from "./MermaidBlock";
import { QuestionBlock } from "./QuestionBlock";
import type { PlanAnswers } from "./types";

export function PlanBlockRenderer({
	block,
	answers,
	onAnswer,
}: {
	block: PlanBlock;
	answers: PlanAnswers;
	onAnswer: (name: string, value: string | string[]) => void;
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
					<span className="text-[13px] font-medium text-gray-100">{block.prompt}</span>
					<QuestionBlock input={block.input} answers={answers} onAnswer={onAnswer} />
				</div>
			);
	}
}
