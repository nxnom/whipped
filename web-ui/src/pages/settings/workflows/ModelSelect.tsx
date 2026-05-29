import { Input, Select, SelectOption } from "@geckoui/geckoui";
import { MODEL_OPTIONS, type RuntimeAgentId } from "@runtime-contract";
import { useEffect, useState } from "react";
import { classNames } from "@/utils/classNames";
import { useRead } from "@/runtime/api-client";

export function ModelSelect({
	agentId,
	value,
	onChange,
}: {
	agentId: RuntimeAgentId;
	value: string;
	onChange: (v: string) => void;
}) {
	const staticOptions = MODEL_OPTIONS[agentId];

	const [dynamicModels, setDynamicModels] = useState<{ value: string; label: string }[]>([]);
	const [isFetching, setIsFetching] = useState(false);

	const { trigger: fetchOpencodeModels } = useRead((api) => api("agents/opencode-models").GET(), { enabled: false });
	const { trigger: fetchCursorModels } = useRead((api) => api("agents/cursor-models").GET(), { enabled: false });

	const fetchDynamicModels = () => {
		setIsFetching(true);
		if (agentId === "opencode") {
			fetchOpencodeModels()
				.then((res) => {
					if (res.data) setDynamicModels(res.data.map((m) => ({ value: m, label: m })));
				})
				.finally(() => setIsFetching(false));
		} else if (agentId === "cursor") {
			fetchCursorModels()
				.then((res) => {
					if (res.data) setDynamicModels(res.data);
				})
				.finally(() => setIsFetching(false));
		}
	};

	useEffect(() => {
		if (agentId === "opencode" || agentId === "cursor") fetchDynamicModels();
	}, [agentId]);

	const options = agentId === "opencode" || agentId === "cursor" ? dynamicModels : staticOptions;

	const isPresetValue = value === "" || options.some((o) => o.value === value);
	const [customMode, setCustomMode] = useState(!isPresetValue);

	return (
		<div className="space-y-2">
			<div className="flex gap-2">
				<div className="flex-1">
					<Select
						value={customMode ? "__custom__" : value}
						onChange={(v) => {
							if (v === "__custom__") {
								setCustomMode(true);
							} else {
								setCustomMode(false);
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
				{(agentId === "opencode" || agentId === "cursor") && (
					<button
						type="button"
						onClick={fetchDynamicModels}
						disabled={isFetching}
						title="Refresh model list"
						className="flex items-center justify-center px-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
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
						agentId === "opencode"
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
