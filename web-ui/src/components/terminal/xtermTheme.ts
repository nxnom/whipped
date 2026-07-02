import type { ITheme } from "@xterm/xterm";

function cssVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	return value || fallback;
}

// Reads the app's live theme tokens (not hardcoded colors) so default/unstyled
// terminal text stays readable in both themes. xterm re-renders its canvas
// when terminal.options.theme is reassigned, so callers can call this again
// on theme change to re-theme an already-mounted terminal (see TaskTerminal /
// RunTerminal's theme-change effect) instead of leaving it locked to whatever
// was active when it connected.
export function xtermTheme(): ITheme {
	return {
		background: cssVar("--color-whip-bg", "#050505"),
		foreground: cssVar("--color-whip-text", "#ededed"),
		cursor: cssVar("--color-whip-text", "#ededed"),
		selectionBackground: cssVar("--color-whip-border-hover", "#3a3a3a"),
	};
}
