export type { ChoiceOption, PlanBlock, PlanDocument, QuestionInput } from "@runtime-contract";

// Client-only — a staged, block-level comment. Never sent to the backend as
// structured data; folded into the composed feedback message on send.
export interface PlanComment {
	id: string;
	blockId: string;
	text: string;
}

// Client-only — answers keyed by each question input's `name`. A `single_choice`
// answer is the selected option's value; `multi_choice` is an array of values;
// `text` is the raw string; `composite` answers are stored per-part under the
// same flat map (each part's own `name` is the key).
export type PlanAnswers = Record<string, string | string[]>;
