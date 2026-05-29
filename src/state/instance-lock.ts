import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { check, lock } from "proper-lockfile";
import { logger } from "../core/logger.js";
import { getDbPath } from "./db.js";

// Single-instance ownership for a whipped server.
//
// The invariant is "one server per database" — two servers (e.g. one accidentally
// started on a second port, or launched by a script/hook/editor/auto-restart) would
// each run their own poller + scheduler against the shared SQLite db and dispatch the
// same cards, spawning duplicate agents.
//
// We lock the resolved db path with proper-lockfile: an atomic mkdir-based lock with
// mtime-based stale detection. That is robust against the two failure modes a PID file
// has — PID reuse (a recycled pid looking "alive") and the check→write TOCTOU race.
// daemon.pid is kept purely as metadata (pid/url for `status`/`stop`/CLI display).

const STALE_MS = 30_000; // a lock not refreshed for this long is considered abandoned
const UPDATE_MS = 10_000; // refresh our lock's mtime this often to prove liveness

function lockfilePath(): string {
	return `${getDbPath()}.lock`;
}

const lockOpts = () => ({ stale: STALE_MS, realpath: false, lockfilePath: lockfilePath() }) as const;

// Whether THIS process currently owns the lock. The process-`exit` handler reads it to
// synchronously remove the lock dir on ANY exit — including a forced one (a second Ctrl+C,
// or shutdown timeout) where the async release never runs. Without it the abandoned lock
// would block the next start until the 30s stale timeout.
let ownsLock = false;
let exitHandlerRegistered = false;

function releaseLockOnExit(): void {
	// Released cleanly already, or another instance reclaimed it after a compromise — in
	// both cases ownsLock is false and we must NOT delete what is no longer ours.
	if (!ownsLock) return;
	try {
		rmSync(lockfilePath(), { recursive: true, force: true });
	} catch {
		// best-effort — the stale timeout is the backstop
	}
}

// Acquire the lock or throw. On success returns a release function. Throws an Error
// with code "ELOCKED" when another live instance already owns the database.
export async function acquireInstanceLock(): Promise<() => Promise<void>> {
	mkdirSync(dirname(getDbPath()), { recursive: true });
	const release = await lock(getDbPath(), {
		...lockOpts(),
		update: UPDATE_MS,
		retries: 0, // fail immediately if held — don't wait
		onCompromised: (err) => {
			// We stopped refreshing the lock long enough for another instance to reclaim it
			// (event loop stalled past `stale`). It's theirs now — drop ownership so the exit
			// handler won't delete their lock — then exit rather than run without ownership.
			ownsLock = false;
			logger.error({ err }, "[instance-lock] DB lock compromised — another instance may have taken over. Exiting.");
			process.exit(1);
		},
	});
	ownsLock = true;
	if (!exitHandlerRegistered) {
		// Synchronous, fires on process.exit() (incl. the graceful-shutdown forced path) and
		// normal exit, so the lock frees immediately however we stop. SIGKILL → stale fallback.
		process.once("exit", releaseLockOnExit);
		exitHandlerRegistered = true;
	}
	return async () => {
		ownsLock = false;
		await release();
	};
}

// True if a live instance currently holds the lock (stale locks count as free).
export async function isInstanceRunning(): Promise<boolean> {
	try {
		return await check(getDbPath(), lockOpts());
	} catch {
		return false;
	}
}

export function isInstanceLockError(err: unknown): boolean {
	return (err as NodeJS.ErrnoException | null)?.code === "ELOCKED";
}

// Remove the lock directory directly. Only safe once the owning process is confirmed
// dead (e.g. `whipped stop` after waitForExit) — proper-lockfile's own unlock() refuses
// to release a lock held by a different process. A no-op if the lock is already gone.
export function forceReleaseInstanceLock(): void {
	try {
		rmSync(lockfilePath(), { recursive: true, force: true });
	} catch {
		// best-effort
	}
}
