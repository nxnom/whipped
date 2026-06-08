import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WHIPPED_HOME_DIR } from "../config/paths.js";

const CACHE_FILE = join(WHIPPED_HOME_DIR, "update-check.json");
const REGISTRY_URL = "https://registry.npmjs.org/whipped/latest";
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface CacheEntry {
	checkedAt: number;
	latestVersion: string;
}

function readCache(): CacheEntry | null {
	try {
		return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as CacheEntry;
	} catch {
		return null;
	}
}

function writeCache(entry: CacheEntry): void {
	try {
		writeFileSync(CACHE_FILE, JSON.stringify(entry));
	} catch {
		/* ignore write errors */
	}
}

function isNewer(latest: string, current: string): boolean {
	const parse = (v: string) =>
		v
			.replace(/[^0-9.]/g, "")
			.split(".")
			.map(Number);
	const [la = 0, lb = 0, lc = 0] = parse(latest);
	const [ca = 0, cb = 0, cc = 0] = parse(current);
	return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

async function fetchLatestVersion(): Promise<string | null> {
	try {
		const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return null;
		const data = (await res.json()) as { version: string };
		writeCache({ checkedAt: Date.now(), latestVersion: data.version });
		return data.version;
	} catch {
		return null;
	}
}

// Returns the latest version string if a newer version is available, null otherwise.
// Used at CLI startup to read from cache without blocking.
export function getCachedUpdateAvailable(currentVersion: string): string | null {
	const cache = readCache();
	if (!cache) return null;
	return isNewer(cache.latestVersion, currentVersion) ? cache.latestVersion : null;
}

// Checks for updates immediately and then every 12 hours.
// Calls onUpdate(latestVersion) whenever a newer version is found.
// No-ops in dev mode (version contains "dev") to avoid false positives from the fallback version.
export function scheduleUpdateChecks(currentVersion: string, onUpdate: (latestVersion: string) => void): void {
	if (currentVersion.includes("dev")) return;

	const check = async () => {
		const latest = await fetchLatestVersion();
		if (latest && isNewer(latest, currentVersion)) {
			onUpdate(latest);
		}
	};

	void check();
	setInterval(() => void check(), CHECK_INTERVAL_MS);
}
