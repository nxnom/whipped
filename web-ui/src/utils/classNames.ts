type ClassValue = string | number | boolean | undefined | null;

export function classNames(...args: ClassValue[]): string {
	return args.filter(Boolean).join(" ");
}
