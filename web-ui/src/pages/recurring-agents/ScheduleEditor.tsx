import { RHFInput, RHFNumberInput, RHFSelect, SelectOption } from "@geckoui/geckoui";
import { useFormContext, useWatch } from "react-hook-form";
import { classNames } from "@/utils/classNames";
import { CALENDAR_FREQUENCIES, type CalendarFrequency, INTERVAL_UNITS, WEEKDAYS } from "./constants";
import { localTimezone } from "./helpers";

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
				active ? "bg-[#ffffff] text-white" : "text-[#8a8f98] hover:text-[#ededed]",
			)}
		>
			{children}
		</button>
	);
}

// RHF-bound schedule editor. Reads/writes the flat schedule fields (see
// ScheduleFields in helpers); the dialog converts them to a RecurringSchedule.
export function ScheduleEditor() {
	const { control, setValue } = useFormContext();
	const kind = (useWatch({ control, name: "scheduleKind" }) ?? "interval") as "interval" | "calendar";
	const freq = (useWatch({ control, name: "calFreq" }) ?? "weekly") as CalendarFrequency;
	const isInterval = kind === "interval";

	return (
		<div className="flex flex-col gap-3">
			<div className="flex gap-1 p-1 rounded-lg bg-[#111111] border border-[#2a2a2a]">
				<TabButton active={isInterval} onClick={() => setValue("scheduleKind", "interval")}>
					Interval
				</TabButton>
				<TabButton active={!isInterval} onClick={() => setValue("scheduleKind", "calendar")}>
					Calendar
				</TabButton>
			</div>

			{isInterval ? (
				<div className="flex items-center gap-2">
					<span className="text-[13px] text-[#8a8f98]">Every</span>
					<RHFNumberInput
						name="intervalValue"
						className="w-20"
						inputClassName="text-center"
						positiveOnly
						maxFractionDigits={0}
					/>
					<div className="w-full">
						<RHFSelect name="intervalUnit">
							{INTERVAL_UNITS.map((u) => (
								<SelectOption key={u.value} value={u.value} label={u.label} />
							))}
						</RHFSelect>
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2.5">
					<RHFSelect name="calFreq">
						{CALENDAR_FREQUENCIES.map((f) => (
							<SelectOption key={f.value} value={f.value} label={f.label} />
						))}
					</RHFSelect>
					<div className="flex items-center gap-2">
						{freq === "weekly" && (
							<div className="flex-1">
								<RHFSelect name="calDow">
									{WEEKDAYS.map((d) => (
										<SelectOption key={d.value} value={String(d.value)} label={d.label} />
									))}
								</RHFSelect>
							</div>
						)}
						{freq === "monthly" && (
							<div className="flex items-center gap-1.5">
								<span className="text-[12px] text-[#8a8f98]">Day</span>
								<RHFNumberInput
									name="calDom"
									className="w-16"
									inputClassName="text-center"
									positiveOnly
									maxFractionDigits={0}
								/>
							</div>
						)}
						<RHFInput
							name="calTime"
							type="time"
							className={classNames("shrink-0", freq === "daily" ? "flex-1" : "w-36")}
						/>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[13px] text-[#8a8f98] w-20 shrink-0">Timezone</span>
						<div className="flex-1">
							<RHFSelect name="calTimezone" filterable>
								{timezoneOptions().map((tz) => (
									<SelectOption key={tz} value={tz} label={tz} />
								))}
							</RHFSelect>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
