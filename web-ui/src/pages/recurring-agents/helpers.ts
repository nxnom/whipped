import type { RecurringSchedule } from "@runtime-contract";
import { type CalendarFrequency, INTERVAL_UNITS } from "./constants";

export function localTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

// Largest whole unit that divides the interval cleanly (3600s → {1, hours}).
export function secondsToUnit(seconds: number): { value: number; unit: string } {
	for (const u of [...INTERVAL_UNITS].reverse()) {
		if (seconds % u.seconds === 0) return { value: seconds / u.seconds, unit: u.value };
	}
	return { value: seconds, unit: "minutes" };
}

export function unitToSeconds(value: number, unit: string): number {
	const u = INTERVAL_UNITS.find((x) => x.value === unit) ?? INTERVAL_UNITS[1]!;
	return Math.max(1, Math.round(value)) * u.seconds;
}

export function buildCron(freq: CalendarFrequency, time: string, dayOfWeek: number, dayOfMonth: number): string {
	const [h, m] = time.split(":").map((x) => Number(x) || 0);
	if (freq === "daily") return `${m} ${h} * * *`;
	if (freq === "weekly") return `${m} ${h} * * ${dayOfWeek}`;
	return `${m} ${h} ${dayOfMonth} * *`;
}

// Parse the simple shapes buildCron emits. Returns null for anything else so the
// editor can fall back to a raw-cron field.
export function parseCron(
	cron: string,
): { freq: CalendarFrequency; time: string; dayOfWeek: number; dayOfMonth: number } | null {
	const parts = cron.trim().split(/\s+/);
	if (parts.length !== 5) return null;
	const [m, h, dom, mon, dow] = parts;
	const min = Number(m);
	const hr = Number(h);
	if (Number.isNaN(min) || Number.isNaN(hr) || mon !== "*") return null;
	const time = `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
	if (dom === "*" && dow === "*") return { freq: "daily", time, dayOfWeek: 1, dayOfMonth: 1 };
	if (dom === "*" && /^[0-6]$/.test(dow!)) return { freq: "weekly", time, dayOfWeek: Number(dow), dayOfMonth: 1 };
	if (/^\d{1,2}$/.test(dom!) && dow === "*") return { freq: "monthly", time, dayOfWeek: 1, dayOfMonth: Number(dom) };
	return null;
}

export function formatSchedule(schedule: RecurringSchedule): string {
	if (schedule.kind === "interval") {
		const { value, unit } = secondsToUnit(schedule.intervalSeconds);
		const singular = value === 1 ? unit.replace(/s$/, "") : unit;
		return `Every ${value} ${singular}`;
	}
	const parsed = parseCron(schedule.cronExpr);
	if (!parsed) return `${schedule.cronExpr} (${schedule.timezone})`;
	if (parsed.freq === "daily") return `Daily at ${parsed.time} (${schedule.timezone})`;
	if (parsed.freq === "weekly") {
		const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][parsed.dayOfWeek];
		return `Weekly · ${day} ${parsed.time} (${schedule.timezone})`;
	}
	return `Monthly · day ${parsed.dayOfMonth} ${parsed.time} (${schedule.timezone})`;
}

export function formatRelative(ts: number | undefined): string {
	if (!ts) return "—";
	const diff = ts - Date.now();
	const abs = Math.abs(diff);
	const mins = Math.round(abs / 60000);
	const hours = Math.round(abs / 3600000);
	const days = Math.round(abs / 86400000);
	const unit = mins < 60 ? `${mins}m` : hours < 48 ? `${hours}h` : `${days}d`;
	if (mins < 1) return "just now";
	return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function formatDuration(start: number, end: number | undefined): string | null {
	if (!end || end < start) return null;
	const secs = Math.round((end - start) / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const rem = secs % 60;
	return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export function formatTimestamp(ts: number | undefined): string {
	if (!ts) return "—";
	return new Date(ts).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
