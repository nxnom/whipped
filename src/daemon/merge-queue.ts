// Serialises work per key so that two tasks sharing a key never run concurrently.
// Used by YOLO merges keyed on `${workspaceId}:${baseRef}`: isolated scratch
// worktrees still share the one branch ref, so concurrent `update-ref` would
// clobber. Different base refs run in parallel.

const chains = new Map<string, Promise<unknown>>();

export function enqueueMerge<T>(key: string, task: () => Promise<T>): Promise<T> {
	const prev = chains.get(key) ?? Promise.resolve();
	// Run regardless of whether the previous task in this chain succeeded.
	const run = prev.then(task, task);
	// `tail` swallows the result so the chain never rejects and stays linkable.
	const tail = run.then(
		() => {},
		() => {},
	);
	chains.set(key, tail);
	void tail.then(() => {
		if (chains.get(key) === tail) chains.delete(key);
	});
	return run;
}
