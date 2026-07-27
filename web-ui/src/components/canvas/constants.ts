// Contract between the agent's HTML and the panel: the agent marks each
// design's clickable root with VALUE_ATTR, the panel marks the chosen one with
// SELECTED_ATTR. Mirrored in the `visual_choice.body` description in
// src/core/api-contract.ts — keep the two in sync.
export const VISUAL_CHOICE_VALUE_ATTR = "data-whipped-value";
export const VISUAL_CHOICE_SELECTED_ATTR = "data-whipped-selected";
