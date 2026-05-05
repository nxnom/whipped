import { useState } from "react";

export function useUrlParam(key: string, defaultValue: string): [string, (v: string | null) => void];
export function useUrlParam(key: string): [string | null, (v: string | null) => void];
export function useUrlParam(key: string, defaultValue?: string): [string | null, (v: string | null) => void] {
	const [value, setValue] = useState<string | null>(() => {
		const params = new URLSearchParams(window.location.search);
		return params.get(key) ?? defaultValue ?? null;
	});

	const update = (newValue: string | null) => {
		const params = new URLSearchParams(window.location.search);
		if (newValue == null) {
			params.delete(key);
		} else {
			params.set(key, newValue);
		}
		const qs = params.toString();
		history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
		setValue(newValue);
	};

	return [value, update];
}
