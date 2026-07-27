import type { CompanionSession } from "@runtime-contract";
import { Plus, Trash2 } from "lucide-react";
import { AGENT_DISPLAY } from "@/pages/board/constants";
import { classNames } from "@/utils/classNames";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "./constants";
import { formatRelativeTime } from "./helpers";

// Sticky lives on the cells, not on <thead>/<tr> — and the rule under the row is
// an inset shadow rather than a border, because with `border-collapse` a sticky
// cell leaves its collapsed border behind and the line scrolls away with the
// rows.
function HeaderCell({ children, className }: { children?: React.ReactNode; className?: string }) {
	return (
		<th
			className={classNames(
				"sticky top-0 z-10 bg-whip-bg text-left font-normal text-[10px] uppercase tracking-[0.1em] text-whip-faint px-4 py-2",
				"shadow-[inset_0_-1px_0_var(--whip-border-soft)]",
				className,
			)}
		>
			{children}
		</th>
	);
}

// Columns, not stacked text: non-worktree sessions all carry the same
// auto-generated name ("Main repo session"), so what actually tells two rows
// apart is reading down the base/agent/last-active columns — which only works
// if they line up.
export function CompanionSessionTable({
	sessions,
	onSelect,
	onNewSession,
	onDelete,
}: {
	sessions: CompanionSession[];
	onSelect: (id: string) => void;
	onNewSession: () => void;
	onDelete: (session: CompanionSession) => void;
}) {
	const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-whip-border bg-whip-bg">
				<div className="flex items-baseline gap-2">
					<h2 className="text-[13px] font-semibold text-whip-text">Sessions</h2>
					<span className="text-[11px] text-whip-faint">{ordered.length}</span>
				</div>
				<button
					onClick={onNewSession}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-whip-accent-text bg-whip-accent hover:opacity-90 transition-opacity shrink-0"
				>
					<Plus size={13} />
					New session
				</button>
			</div>

			<div className="flex-1 min-h-0 overflow-y-auto">
				<table className="w-full border-collapse">
					<thead>
						<tr>
							<HeaderCell>Status</HeaderCell>
							<HeaderCell>Session</HeaderCell>
							<HeaderCell>Base</HeaderCell>
							<HeaderCell>Agent</HeaderCell>
							<HeaderCell>Last active</HeaderCell>
							<HeaderCell className="w-10" />
						</tr>
					</thead>
					<tbody>
						{ordered.map((session) => {
							const agent = AGENT_DISPLAY[session.agentId];
							const model = [session.model, session.effort].filter(Boolean).join(" · ");

							return (
								<tr
									key={session.id}
									onClick={() => onSelect(session.id)}
									className="group cursor-pointer border-b border-whip-border-soft last:border-b-0 hover:bg-whip-panel transition-colors"
								>
									<td className="px-4 py-2.5">
										<span
											className={classNames(
												"flex items-center gap-2 text-[11.5px]",
												session.status === "running" ? "text-[#22c55e]" : "text-whip-faint",
											)}
										>
											<span
												className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[session.status])}
											/>
											{STATUS_LABEL[session.status]}
										</span>
									</td>
									{/* w-full + max-w-0 is what makes the auto table layout give this column
								    the leftover width while still letting a long branch name truncate. */}
									<td className="px-4 py-2.5 w-full max-w-0">
										{/* A table row can't take focus, so the name doubles as the row's
									    keyboard-reachable control — the row click is the mouse shortcut. */}
										<button
											onClick={(e) => {
												e.stopPropagation();
												onSelect(session.id);
											}}
											className="block w-full text-left text-[12.5px] font-medium text-whip-text truncate"
										>
											{session.name}
										</button>
									</td>
									<td className="px-4 py-2.5 font-mono text-[11.5px] text-whip-muted whitespace-nowrap">
										{session.baseRef}
									</td>
									<td className="px-4 py-2.5 whitespace-nowrap">
										<span className="flex items-center gap-1.5 text-[11.5px] text-whip-faint">
											<span
												className={classNames("size-[5px] rounded-full shrink-0", agent?.dotColor ?? "bg-whip-faint")}
											/>
											{agent?.label ?? session.agentId}
											{model && <span className="font-mono text-whip-faint">{model}</span>}
										</span>
									</td>
									<td className="px-4 py-2.5 font-mono text-[11.5px] text-whip-faint whitespace-nowrap">
										{formatRelativeTime(session.updatedAt)}
									</td>
									<td className="pl-1 pr-3 py-2.5">
										{/* Dim but present at rest, so a long list isn't a column of trash
									    icons. Opacity (not colour) carries the row-hover lift, so it can't
									    fight the danger colour on direct hover. */}
										<button
											onClick={(e) => {
												e.stopPropagation();
												onDelete(session);
											}}
											title="Delete session"
											aria-label={`Delete ${session.name}`}
											className="flex items-center justify-center size-6 rounded-md text-whip-faint opacity-35 group-hover:opacity-100 hover:text-[#ff3b4d] hover:bg-[#ff3b4d]/10 transition-all"
										>
											<Trash2 size={13} />
										</button>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
