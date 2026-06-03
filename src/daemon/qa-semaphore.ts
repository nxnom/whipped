// Machine-wide cap on concurrent QA runs. A QA slot boots the project's app and
// (optionally) a browser, which is heavy on RAM/CPU and prone to port clashes —
// so the limit is process-global, shared across every workspace, not per-project.
// At limit 1 a QA whose turn arrives waits (FIFO) for the running one to finish.
export class QaSemaphore {
	private limit: number;
	private active = 0;
	private waiters: Array<() => void> = [];

	constructor(limit: number) {
		this.limit = Math.max(1, limit);
	}

	get activeCount(): number {
		return this.active;
	}

	get queuedCount(): number {
		return this.waiters.length;
	}

	// True when acquire() would block — used to log/surface the wait before queuing.
	wouldBlock(): boolean {
		return this.active >= this.limit;
	}

	setLimit(limit: number): void {
		this.limit = Math.max(1, limit);
		this.drain();
	}

	async acquire(): Promise<() => void> {
		await new Promise<void>((resolve) => {
			this.waiters.push(resolve);
			this.drain();
		});
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active--;
			this.drain();
		};
	}

	// Admit waiters up to the limit. `active` is incremented here (synchronously,
	// in the same loop turn) so the limit can't be overshot by a burst of waiters
	// resolving before their acquire() continuations run.
	private drain(): void {
		while (this.active < this.limit && this.waiters.length > 0) {
			const next = this.waiters.shift();
			this.active++;
			next?.();
		}
	}
}
