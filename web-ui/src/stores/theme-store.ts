import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "whip-theme";

function readInitialTheme(): Theme {
	return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
}

// Module-level so every component sharing this store stays in sync, same
// pattern as useUpdateAvailable in board-store.ts.
let _theme: Theme = readInitialTheme();
const _listeners = new Set<() => void>();

function applyTheme(theme: Theme) {
	document.documentElement.classList.remove("dark", "light");
	document.documentElement.classList.add(theme);
}

export function setTheme(theme: Theme) {
	if (theme === _theme) return;
	_theme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
	applyTheme(theme);
	for (const cb of _listeners) cb();
}

export function toggleTheme() {
	setTheme(_theme === "dark" ? "light" : "dark");
}

export function useTheme(): Theme {
	const [theme, setThemeState] = useState(_theme);
	useEffect(() => {
		const notify = () => setThemeState(_theme);
		_listeners.add(notify);
		return () => {
			_listeners.delete(notify);
		};
	}, []);
	return theme;
}
