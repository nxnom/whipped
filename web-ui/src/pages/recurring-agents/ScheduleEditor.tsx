import { Input, Select, SelectOption } from "@geckoui/geckoui";
import type { RecurringSchedule } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import {
	CALENDAR_FREQUENCIES,
	type CalendarFrequency,
	DEFAULT_CALENDAR_TIME,
	DEFAULT_INTERVAL_SECONDS,
	INTERVAL_UNITS,
	WEEKDAYS,
} from "./constants";
import { buildCron, localTimezone, parseCron, secondsToUnit, unitToSeconds } from "./helpers";

function timezoneOptions(): string[] {
	const supported = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
	const list = supported ? supported("timeZone") : [];
	const tz = localTimezone();
	return list.length ? Array.from(new Set([tz, "UTC", ...list])) : Array.from(new Set([tz, "UTC"]));
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={classNames(
				"flex-1 py-1.5 text-[13px] rounded-md transition-colors",
				active ? "bg-[#7c6aff] text-white" : "text-[#8888a0] hover:text-[#f0f0f5]",
			)}
		>
			{children}
		</button>
	);
}

export function ScheduleEditor({
	value,
	onChange,
	floatingStrategy,
}: {
	value: RecurringSchedule;
	onChange: (next: RecurringSchedule) => void;
	floatingStrategy?: "fixed" | "absolute";
}) {
	const isInterval = value.kind === "interval";
	const interval = isInterval ? secondsToUnit(value.intervalSeconds) : { value: 1, unit: "hours" };
	const parsed = value.kind === "calendar" ? parseCron(value.cronExpr) : null;
	const freq: CalendarFrequency = parsed?.freq ?? "weekly";
	const time = parsed?.time ?? DEFAULT_CALENDAR_TIME;
	const dayOfWeek = parsed?.dayOfWeek ?? 1;
	const dayOfMonth = parsed?.dayOfMonth ?? 1;
	const timezone = value.kind === "calendar" ? value.timezone : localTimezone();

	const setInterval = (v: number, unit: string) =>
		onChange({ kind: "interval", intervalSeconds: unitToSeconds(v, unit) });

	const setCalendar = (
		next: Partial<{ freq: CalendarFrequency; time: string; dow: number; dom: number; tz: string }>,
	) =>
		onChange({
			kind: "calendar",
			cronExpr: buildCron(next.freq ?? freq, next.time ?? time, next.dow ?? dayOfWeek, next.dom ?? dayOfMonth),
			timezone: next.tz ?? timezone,
		});

	return (
		<div className="flex flex-col gap-3">
			<div className="flex gap-1 p-1 rounded-lg bg-[#1a1a1f] border border-[#2a2a35]">
				<TabButton
					active={isInterval}
					onClick={() => onChange({ kind: "interval", intervalSeconds: DEFAULT_INTERVAL_SECONDS })}
				>
					Interval
				</TabButton>
				<TabButton
					active={!isInterval}
					onClick={() =>
						onChange({ kind: "calendar", cronExpr: buildCron("weekly", time, dayOfWeek, dayOfMonth), timezone })
					}
				>
					Calendar
				</TabButton>
			</div>

			{isInterval ? (
				<div className="flex items-center gap-2">
					<span className="text-[13px] text-[#8888a0]">Every</span>
					<Input
						type="number"
						min={1}
						value={String(interval.value)}
						inputClassName="text-center"
						className="w-20"
						onChange={(e) => setInterval(Number(e.target.value) || 1, interval.unit)}
					/>
					<div className="w-32">
						<Select
							value={interval.unit}
							floatingStrategy={floatingStrategy}
							onChange={(u) => setInterval(interval.value, u)}
						>
							{INTERVAL_UNITS.map((u) => (
								<SelectOption key={u.value} value={u.value} label={u.label} />
							))}
						</Select>
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2.5">
					<div className="flex items-center gap-2">
						<div className="w-36">
							<Select
								value={freq}
								floatingStrategy={floatingStrategy}
								onChange={(f) => setCalendar({ freq: f as CalendarFrequency })}
							>
								{CALENDAR_FREQUENCIES.map((f) => (
									<SelectOption key={f.value} value={f.value} label={f.label} />
								))}
							</Select>
						</div>
						{freq === "weekly" && (
							<div className="w-36">
								<Select
									value={String(dayOfWeek)}
									floatingStrategy={floatingStrategy}
									onChange={(d) => setCalendar({ dow: Number(d) })}
								>
									{WEEKDAYS.map((d) => (
										<SelectOption key={d.value} value={String(d.value)} label={d.label} />
									))}
								</Select>
							</div>
						)}
						{freq === "monthly" && (
							<Input
								type="number"
								min={1}
								max={28}
								value={String(dayOfMonth)}
								className="w-20"
								inputClassName="text-center"
								prefix="Day"
								onChange={(e) => setCalendar({ dom: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })}
							/>
						)}
						<Input
							type="time"
							value={time}
							className="w-28"
							onChange={(e) => setCalendar({ time: e.target.value || DEFAULT_CALENDAR_TIME })}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-[#8888a0] w-20 shrink-0">Timezone</span>
						<div className="flex-1">
							<Select
								value={timezone}
								floatingStrategy={floatingStrategy}
								onChange={(tz) => setCalendar({ tz })}
								filterable
							>
								{timezoneOptions().map((tz) => (
									<SelectOption key={tz} value={tz} label={tz} />
								))}
							</Select>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
