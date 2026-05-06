import { useSearchParams } from "react-router-dom";

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
