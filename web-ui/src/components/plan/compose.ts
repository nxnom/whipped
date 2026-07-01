import type { PlanBlock, QuestionInput } from "@runtime-contract";
import type { PlanAnswers, PlanComment } from "./types";

function excerpt(block: PlanBlock): string {
	if (block.type === "markdown") return block.body.split("\n")[0]?.slice(0, 60) ?? block.id;
	if (block.type === "html")
		return (
			block.body
				.replace(/<[^>]+>/g, " ")
				.trim()
				.slice(0, 60) || block.id
		);
	if (block.type === "diagram") return block.caption ?? "diagram";
	return block.prompt.slice(0, 60);
}

// Always emits a line per leaf input — an unanswered question is stated
// explicitly ("(not answered)") rather than omitted, so the agent can never
// mistake "skipped because optional" for "this didn't render" or "this is
// broken". Omitting silent gaps here is exactly what caused that confusion.
function formatAnswer(input: QuestionInput, answers: PlanAnswers): string[] {
	if (input.kind === "composite") return input.parts.flatMap((part) => formatAnswer(part, answers));
	const value = answers[input.name];
	const label = input.label ?? input.name;
	const empty = value === undefined || (Array.isArray(value) && value.length === 0) || value === "";
	if (empty) return [`- ${label}: (not answered)`];
	if (input.kind === "single_choice") {
		const opt = input.options.find((o) => o.value === value);
		return [`- ${label}: ${opt?.label ?? value}`];
	}
	if (input.kind === "multi_choice") {
		const values = Array.isArray(value) ? value : [value];
		const labels = values.map((v) => input.options.find((o) => o.value === v)?.label ?? v);
		return [`- ${label}: ${labels.join(", ")}`];
	}
	return [`- ${label}: ${value}`];
}

// Flattens staged answers/comments/note into one message, folded into a single
// terminal write — mirrors DiffView's reviewSummary() pattern. `approved` adds
// an explicit go-ahead marker without discarding whatever else was staged —
// approving and leaving feedback aren't mutually exclusive.
export function composePlanFeedbackMessage(
	version: number,
	blocks: PlanBlock[],
	answers: PlanAnswers,
	comments: PlanComment[],
	note: string,
	approved: boolean,
): string {
	const sections: string[] = [`## Feedback on plan v${version}`];

	if (approved) sections.push("**Approved — go ahead.**");

	const answerLines = blocks
		.filter((b): b is Extract<PlanBlock, { type: "question" }> => b.type === "question")
		.flatMap((b) => [`**Q: ${b.prompt}**`, ...formatAnswer(b.input, answers)]);
	if (answerLines.length) sections.push(answerLines.join("\n"));

	if (comments.length) {
		const commentLines = comments.map((c) => {
			const block = blocks.find((b) => b.id === c.blockId);
			return `**Comment on "${block ? excerpt(block) : c.blockId}":**\n> ${c.text}`;
		});
		sections.push(commentLines.join("\n\n"));
	}

	if (note.trim()) sections.push(note.trim());

	return sections.join("\n\n");
}
