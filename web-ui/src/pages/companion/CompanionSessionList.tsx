import type { CompanionSession } from "@runtime-contract";
import { classNames } from "@/utils/classNames";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "./constants";

export function CompanionSessionList({
	sessions,
	selectedId,
	onSelect,
}: {
	sessions: CompanionSession[];
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	if (sessions.length === 0) {
		return (
			<div className="px-4 py-6 text-[13px] text-[#60607a]">
				No companion sessions yet. Start one to pair directly with a coding agent.
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{sessions.map((session) => {
				const active = session.id === selectedId;
				return (
					<button
						key={session.id}
						type="button"
						onClick={() => onSelect(session.id)}
						className={classNames(
							"flex flex-col gap-1 px-4 py-3 text-left border-b border-[#1f1f27] transition-colors",
							active ? "bg-[#1a1a22]" : "hover:bg-[#15151b]",
						)}
					>
						<div className="flex items-center gap-2">
							<span className={classNames("size-1.5 rounded-full shrink-0", STATUS_DOT_CLASS[session.status])} />
							<span className="text-[13px] font-medium text-[#f0f0f5] truncate">{session.name}</span>
						</div>
						<div className="flex items-center justify-between gap-2 pl-3.5">
							<span className="text-[11px] text-[#60607a] truncate font-mono">
								{session.useWorktree ? session.branchName : "main repo"}
							</span>
							<span className="text-[11px] text-[#4a4a5a] shrink-0">{STATUS_LABEL[session.status]}</span>
						</div>
					</button>
				);
			})}
		</div>
	);
}
