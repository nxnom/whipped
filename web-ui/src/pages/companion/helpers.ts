const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Coarsens as it goes: a session touched minutes ago is worth the precision,
// one from last month isn't — past a week the calendar date says more than
// "34d ago" does.
export function formatRelativeTime(timestamp: number): string {
	const elapsed = Date.now() - timestamp;
	if (elapsed < MINUTE) return "now";
	if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
	if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
	if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;
	return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
