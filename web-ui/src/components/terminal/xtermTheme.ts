import type { ITheme } from "@xterm/xterm";

// Reads the actual --color-whip-bg value so the terminal background always tracks
// the app's main background token instead of drifting to its own hardcoded shade.
export function xtermTheme(): ITheme {
	const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-whip-bg").trim() || "#050505";
	return {
		background: bg,
		foreground: "#ededed",
		cursor: "#ffffff",
		selectionBackground: "#2a2a2a",
	};
}
