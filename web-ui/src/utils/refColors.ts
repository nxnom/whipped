// Palette for `#N` element references, shared by the comment renderer and the
// comment composer. Matches the Whipped browser extension so an element keeps the
// same colour from selection → paste → rendered comment.
export const REF_PALETTE = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#22d3ee", "#a3e635"];

export const refColor = (i: number): string => REF_PALETTE[i % REF_PALETTE.length] as string;
