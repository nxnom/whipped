import { useSearchParams } from "react-router-dom";

export const FULLSCREEN_PARAM = "fullscreen";

// Fullscreen lives in the URL so the browser back button leaves it — entering
// pushes a history entry, exiting replaces it so back doesn't drop you straight
// back in.
export function useFullscreen() {
	const [searchParams, setSearchParams] = useSearchParams();

	const setFullscreen = (on: boolean) => {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				if (on) next.set(FULLSCREEN_PARAM, "1");
				else next.delete(FULLSCREEN_PARAM);
				return next;
			},
			{ replace: !on },
		);
	};

	return { fullscreen: searchParams.get(FULLSCREEN_PARAM) === "1", setFullscreen };
}

export function useUrlParam(key: string, defaultValue: string): [string, (v: string | null) => void];
export function useUrlParam(key: string): [string | null, (v: string | null) => void];
export function useUrlParam(key: string, defaultValue?: string): [string | null, (v: string | null) => void] {
	const [searchParams, setSearchParams] = useSearchParams();
	const value = searchParams.get(key) ?? defaultValue ?? null;

	const update = (newValue: string | null) => {
		setSearchParams(
			(prev) => {
				const next = new URLSearchParams(prev);
				if (newValue == null) {
					next.delete(key);
				} else {
					next.set(key, newValue);
				}
				return next;
			},
			{ replace: true },
		);
	};

	return [value, update] as [string | null, (v: string | null) => void];
}
