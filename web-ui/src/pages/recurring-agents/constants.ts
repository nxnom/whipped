import type { AgentModelChoice } from "@runtime-contract";

// Interval units offered in the UI; intervals are stored in seconds on the backend.
export const INTERVAL_UNITS: ReadonlyArray<{ value: string; label: string; seconds: number }> = [
	{ value: "minutes", label: "minutes", seconds: 60 },
	{ value: "hours", label: "hours", seconds: 3600 },
	{ value: "days", label: "days", seconds: 86400 },
];

export type CalendarFrequency = "daily" | "weekly" | "monthly";

export const CALENDAR_FREQUENCIES: ReadonlyArray<{ value: CalendarFrequency; label: string }> = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
];

// Cron day-of-week is 0=Sunday … 6=Saturday.
export const WEEKDAYS: ReadonlyArray<{ value: number; label: string }> = [
	{ value: 1, label: "Monday" },
	{ value: 2, label: "Tuesday" },
	{ value: 3, label: "Wednesday" },
	{ value: 4, label: "Thursday" },
	{ value: 5, label: "Friday" },
	{ value: 6, label: "Saturday" },
	{ value: 0, label: "Sunday" },
];

export const DEFAULT_INTERVAL_SECONDS = 3600;
export const DEFAULT_CRON = "0 9 * * 1";
export const DEFAULT_CALENDAR_TIME = "09:00";

export const DEFAULT_MODEL_CHOICE: AgentModelChoice = { agentId: "claude", model: null, effort: "low" };
