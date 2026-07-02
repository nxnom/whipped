import { Input, Select, SelectOption } from "@geckoui/geckoui";
import { MODEL_OPTIONS, type RuntimeAgentId } from "@runtime-contract";
import { useState } from "react";
import { classNames } from "@/utils/classNames";
import { useRead } from "@/runtime/api-client";

export function ModelSelect({
	agentId,
	value,
	onChange,
	floatingStrategy,
	menuClassName,
}: {
	agentId: RuntimeAgentId;
	value: string;
	onChange: (v: string) => void;
	floatingStrategy?: "fixed" | "absolute";
	menuClassName?: string;
}) {
	const staticOptions = MODEL_OPTIONS[agentId];
	const isDynamic = agentId === "opencode" || agentId === "cursor" || agentId === "mimo";

	// opencode/cursor/mimo expose their model list at runtime. The read is enabled
	// per agent, so Spoosh fetches (and caches) it on mount and whenever agentId
	// changes — no effect, and `data`/`fetching` drive the UI directly.
	const modelsRead = useRead(
		(api) =>
			api("agents/models").GET({
				query: { agent: agentId === "cursor" ? "cursor" : agentId === "mimo" ? "mimo" : "opencode" },
			}),
		{ enabled: isDynamic },
	);
	const dynamicModels = modelsRead.data ?? [];
	const isFetching = modelsRead.fetching;

	const options = isDynamic ? dynamicModels : staticOptions;

	// Custom mode is on when the user explicitly picked "Custom…" or the current
	// value isn't one of the presets (e.g. a previously-saved custom model). Derived
	// so it stays correct when options load asynchronously or `value` changes.
	const [customChosen, setCustomChosen] = useState(false);
	const isPresetValue = value === "" || options.some((o) => o.value === value);
	const customMode = customChosen || !isPresetValue;

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<div className="flex-1">
					<Select
						floatingStrategy={floatingStrategy}
						menuClassName={menuClassName}
						value={customMode ? "__custom__" : value}
						onChange={(v) => {
							if (v === "__custom__") {
								setCustomChosen(true);
							} else {
								setCustomChosen(false);
								onChange(v);
							}
						}}
						filterable
					>
						<SelectOption value="" label="Default" />
						{options.map((o) => (
							<SelectOption key={o.value} value={o.value} label={o.label} />
						))}
						<SelectOption value="__custom__" label="Custom..." />
					</Select>
				</div>
				{isDynamic && (
					<button
						type="button"
						onClick={() => void modelsRead.trigger()}
						disabled={isFetching}
						title="Refresh model list"
						className="flex items-center justify-center px-2 rounded border border-[var(--color-border-secondary)] bg-whip-panel hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
					>
						<svg
							className={classNames("w-4 h-4", isFetching ? "animate-spin" : "")}
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
					</button>
				)}
			</div>
			{customMode && (
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={
						agentId === "opencode" || agentId === "mimo"
							? "e.g. anthropic/claude-opus-4-7"
							: agentId === "cursor"
								? "e.g. claude-opus-4-7-thinking-max"
								: agentId === "claude"
									? "e.g. claude-opus-4-7"
									: "e.g. gpt-5-codex"
					}
				/>
			)}
		</div>
	);
}
