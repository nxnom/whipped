import { Menu, MenuItem, MenuTrigger, Tooltip } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { ChevronDown, GitMerge, GitPullRequest, Play, Plus, Square, Trash2 } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { STATUS_DOT_CLASS } from "./constants";

interface CompanionBarProps {
	session: CompanionSession;
	sessions: CompanionSession[];
	onSelectSession: (id: string) => void;
	onNewSession: () => void;
	canvasVersion: number | null;
	hasStartCommand: boolean;
	projectRunActive: boolean;
	onRunProject: () => void;
	onStopProjectRun: () => void;
	onStopSession: () => void;
	canMerge: boolean;
	onMerge: () => void;
	onCreatePR: () => void;
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
	tone = "default",
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	tone?: "default" | "danger";
}) {
	return (
		<button
			onClick={onClick}
			className={classNames(
				"flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-whip-border bg-whip-panel text-xs font-semibold transition-colors shrink-0",
				tone === "danger" ? "text-[#ff3b4d] hover:bg-[#ff3b4d]/10" : "text-whip-muted hover:text-whip-text",
			)}
		>
			{icon}
			{label}
		</button>
	);
}

export function CompanionBar({
	session,
	sessions,
	onSelectSession,
	onNewSession,
	canvasVersion,
	hasStartCommand,
	projectRunActive,
	onRunProject,
	onStopProjectRun,
	onStopSession,
	canMerge,
	onMerge,
	onCreatePR,
	onDelete,
}: CompanionBarProps) {
	const repoChip = session.useWorktree ? session.branchName : "main repo";
	const modelChip = [session.agentId, session.model, session.effort].filter(Boolean).join(" · ");

	return (
		<div className="shrink-0 flex items-center gap-3 py-1 border-t border-whip-border bg-whip-surface overflow-x-auto">
			<Menu placement="top-start" floatingStrategy="fixed">
				<MenuTrigger>
					{({ toggleMenu, open }) => (
						<button
							onClick={toggleMenu}
							className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-md hover:bg-whip-panel transition-colors"
						>
							<span className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[session.status])} />
							<span className="text-[13px] font-bold text-whip-text truncate max-w-[220px]">{session.name}</span>
							<ChevronDown
								size={12}
								className={classNames("text-whip-faint transition-transform shrink-0", open && "rotate-180")}
							/>
						</button>
					)}
				</MenuTrigger>
				{sessions.map((s) => (
					<MenuItem
						key={s.id}
						onClick={() => onSelectSession(s.id)}
						className={classNames(s.id === session.id && "bg-whip-panel-2 text-whip-text")}
					>
						<div className="flex items-center gap-2 min-w-0">
							<span className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[s.status])} />
							<span className="truncate">{s.name}</span>
						</div>
					</MenuItem>
				))}
				<MenuItem onClick={onNewSession}>
					<span className="flex items-center gap-1.5">
						<Plus size={12} /> New Session
					</span>
				</MenuItem>
			</Menu>

			<Divider />
			<Chip>{repoChip}</Chip>
			<Divider />
			<Chip>base: {session.baseRef}</Chip>
			{modelChip && (
				<>
					<Divider />
					<Chip>{modelChip}</Chip>
				</>
			)}
			{canvasVersion !== null && (
				<>
					<Divider />
					<Chip>canvas v{canvasVersion}</Chip>
				</>
			)}

			<div className="flex-1" />

			{session.status === "running" && (
				<Tooltip delayDuration={0} content="Stop this session" side="top" triggerAsChild>
					<span>
						<ActionButton icon={<Square size={13} />} label="Stop" onClick={onStopSession} />
					</span>
				</Tooltip>
			)}
			{hasStartCommand &&
				!!session.worktreePath &&
				(projectRunActive ? (
					<ActionButton icon={<Square size={13} className="fill-current" />} label="Stop" onClick={onStopProjectRun} />
				) : (
					<ActionButton icon={<Play size={13} className="fill-current" />} label="Run" onClick={onRunProject} />
				))}
			{canMerge && (
				<>
					<ActionButton icon={<GitMerge size={13} />} label="Merge" onClick={onMerge} />
					<ActionButton icon={<GitPullRequest size={13} />} label="PR" onClick={onCreatePR} />
				</>
			)}
			<Divider />
			<ActionButton icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} tone="danger" />
		</div>
	);
}
