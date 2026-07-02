import { Menu, MenuItem, MenuTrigger, Tooltip } from "@geckoui/geckoui";
import type { RecurringAgent } from "@runtime-contract";
import { ChevronDown, Ellipsis, Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { formatRelative, formatSchedule } from "./helpers";

interface RecurringAgentBarProps {
	agent: RecurringAgent;
	agents: RecurringAgent[];
	onSelectAgent: (id: string) => void;
	onNewAgent: () => void;
	modelLabel: string;
	running: boolean;
	onRunNow: () => void;
	onEdit: () => void;
	onToggleEnabled: (enabled: boolean) => void;
	onDelete: () => void;
}

function Chip({ children }: { children: React.ReactNode }) {
	return <span className="text-[11px] font-semibold text-whip-muted truncate">{children}</span>;
}

function Divider() {
	return <div className="w-px h-4 bg-whip-border shrink-0" />;
}

function ActionButton({
	icon,
	label,
	onClick,
	disabled,
	tone = "default",
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	tone?: "default" | "danger";
}) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={classNames(
				"flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-whip-border bg-whip-panel text-xs font-semibold transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
				tone === "danger" ? "text-[#ff3b4d] hover:bg-[#ff3b4d]/10" : "text-whip-muted hover:text-whip-text",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

export function RecurringAgentBar({
	agent,
	agents,
	onSelectAgent,
	onNewAgent,
	modelLabel,
	running,
	onRunNow,
	onEdit,
	onToggleEnabled,
	onDelete,
}: RecurringAgentBarProps) {
	const finished = agent.recentRuns.filter((r) => r.status !== "running").length;
	const okRuns = agent.recentRuns.filter((r) => r.status === "ok").length;
	const successRate = finished ? Math.round((okRuns / finished) * 100) : null;

	return (
		<div className="shrink-0 flex items-center gap-3 py-1 border-t border-whip-border bg-whip-surface overflow-x-auto">
			<Menu placement="top-start" floatingStrategy="fixed">
				<MenuTrigger>
					{({ toggleMenu, open }) => (
						<button
							onClick={toggleMenu}
							className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-md hover:bg-whip-panel transition-colors"
						>
							<span
								className={classNames(
									"size-1.5 rounded-full shrink-0",
									agent.enabled ? "bg-[#22c55e]" : "bg-whip-muted",
								)}
							/>
							<span className="text-[13px] font-bold text-whip-text truncate max-w-[220px]">{agent.name}</span>
							<ChevronDown
								size={12}
								className={classNames("text-whip-faint transition-transform shrink-0", open && "rotate-180")}
							/>
						</button>
					)}
				</MenuTrigger>
				{agents.map((a) => (
					<MenuItem
						key={a.id}
						onClick={() => onSelectAgent(a.id)}
						className={classNames(a.id === agent.id && "bg-whip-panel-2 text-whip-text")}
					>
						<div className="flex items-center gap-2 min-w-0">
							<span
								className={classNames("size-1.5 rounded-full shrink-0", a.enabled ? "bg-[#22c55e]" : "bg-whip-muted")}
							/>
							<span className="truncate">{a.name}</span>
						</div>
					</MenuItem>
				))}
				<MenuItem onClick={onNewAgent}>
					<span className="flex items-center gap-1.5">
						<Plus size={12} /> New Agent
					</span>
				</MenuItem>
			</Menu>

			<Divider />
			<Chip>{formatSchedule(agent.schedule)}</Chip>
			<Divider />
			<Chip>{modelLabel}</Chip>
			{agent.enabled && (
				<>
					<Divider />
					<Chip>next {formatRelative(agent.nextRunAt)}</Chip>
				</>
			)}
			<Divider />
			<Chip>
				{agent.recentRuns.length} run{agent.recentRuns.length !== 1 ? "s" : ""}
				{successRate !== null ? ` · ${successRate}%` : ""}
			</Chip>

			<div className="flex-1" />

			<Tooltip delayDuration={0} content={running ? "Starting..." : "Run now"} side="top" triggerAsChild>
				<span>
					<ActionButton
						icon={<Play size={13} className="fill-current" />}
						label="Run now"
						onClick={onRunNow}
						disabled={running}
					/>
				</span>
			</Tooltip>
			<ActionButton icon={<Pencil size={13} />} label="Edit" onClick={onEdit} />
			<Menu placement="top-end" floatingStrategy="fixed">
				<MenuTrigger>
					{({ toggleMenu }) => (
						<button
							onClick={toggleMenu}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-whip-border bg-whip-panel text-xs font-semibold text-whip-muted hover:text-whip-text transition-colors shrink-0"
						>
							<Ellipsis size={13} />
							More
						</button>
					)}
				</MenuTrigger>
				<MenuItem onClick={() => onToggleEnabled(!agent.enabled)}>
					<span className="flex items-center gap-1.5">
						<Power size={12} /> {agent.enabled ? "Disable agent" : "Enable agent"}
					</span>
				</MenuItem>
				<MenuItem onClick={onDelete}>
					<span className="flex items-center gap-1.5 text-[#ff3b4d]">
						<Trash2 size={12} /> Delete agent
					</span>
				</MenuItem>
			</Menu>
		</div>
	);
}
