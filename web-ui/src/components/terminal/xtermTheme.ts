import type { ITheme } from "@xterm/xterm";

// The terminal is intentionally pinned to dark regardless of the app theme.
// Agent TUIs choose their colors for a dark background, and the raw byte
// stream (including any explicit color escapes) is persisted verbatim to the
// on-disk .ansi buffers for replay — so a fixed dark surface (the app's
// dark-theme tokens) keeps live output and replayed buffers consistent and
// readable in both app themes.
export const XTERM_THEME: ITheme = {
	background: "#050505",
	foreground: "#ededed",
	cursor: "#ededed",
	selectionBackground: "#3a3a3a",
};
