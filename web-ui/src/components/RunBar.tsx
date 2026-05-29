import { toast } from "@geckoui/geckoui";
import { Square, Terminal } from "lucide-react";
import { useState } from "react";
import { RunTerminal } from "@/components/terminal/RunTerminal";
import { useWorkspaceState } from "@/stores/board-store";
import { useRunSession } from "@/stores/run-session-store";
import { classNames } from "@/utils/classNames";

interface RunBarProps {
	workspaceId: string;
}

export function RunBar({ workspaceId }: RunBarProps) {
	const { session, stop } = useRunSession(workspaceId);
	const { state } = useWorkspaceState(workspaceId);
	const [expanded, setExpanded] = useState(true);

	const card = session.cardId ? (state?.board.cards[session.cardId] ?? null) : null;
	const cardTitle = session.cardId ? (card?.description?.split("\n")[0] ?? session.cardId) : null;
	const cardAgentId = card?.agentId ?? null;

	const isVisible =
		session.status === "running" ||
		session.status === "error" ||
		(session.status === "stopped" && session.cardId !== null);
	if (!isVisible) return null;

	const title = session.cardId === null ? "Base repo" : (cardTitle ?? session.cardId ?? "Unknown");

	const handleStop = async () => {
		try {
			await stop();
		} catch {
			toast.error("Failed to stop");
		}
	};

	const statusDot =
		session.status === "running" ? (
			<span className="size-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
		) : session.status === "error" ? (
			<span className="size-2 rounded-full bg-red-400 shrink-0" />
		) : (
			<span className="size-2 rounded-full bg-gray-500 shrink-0" />
		);

	const statusLabel = session.status === "running" ? "Running" : session.status === "error" ? "Crashed" : "Stopped";

	return (
		<div className="shrink-0 border-t border-[#2a2a35] bg-[#141418] flex flex-col">
			<div className="flex items-center gap-2.5 px-5 py-2">
				<div className="flex items-center gap-1.5 shrink-0">
					{statusDot}
					<span
						className={classNames(
							"text-[11px] font-semibold",
							session.status === "running"
								? "text-blue-400"
								: session.status === "error"
									? "text-red-400"
									: "text-gray-500",
						)}
					>
						{statusLabel}
					</span>
				</div>
				<div className="w-px h-4 bg-[#2a2a35] shrink-0" />
				<span className="text-[11px] font-medium text-[#f0f0f5] truncate flex-1 min-w-0">{title}</span>
				{cardAgentId &&
					(() => {
						const colors: Record<string, { dot: string; text: string; bg: string }> = {
							claude: { dot: "bg-[#7c6aff]", text: "text-[#7c6aff]", bg: "bg-[#7c6aff]/10" },
							codex: { dot: "bg-[#22c55e]", text: "text-[#22c55e]", bg: "bg-[#22c55e]/10" },
							cursor: { dot: "bg-[#3b82f6]", text: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10" },
							opencode: { dot: "bg-[#f97316]", text: "text-[#f97316]", bg: "bg-[#f97316]/10" },
						};
						const ac = colors[cardAgentId] ?? { dot: "bg-gray-500", text: "text-gray-400", bg: "bg-gray-500/10" };
						return (
							<span
								className={classNames(
									"flex items-center gap-1 text-[9px] font-medium px-2 py-1 rounded-full shrink-0",
									ac.bg,
									ac.text,
								)}
							>
								<span className={classNames("size-[5px] rounded-full", ac.dot)} />
								{cardAgentId}
							</span>
						);
					})()}
				{session.status === "error" && session.errorMessage && (
					<span className="text-[11px] text-red-400 truncate max-w-xs shrink-0">{session.errorMessage}</span>
				)}
				<button
					onClick={() => setExpanded((v) => !v)}
					className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-400 transition-colors shrink-0"
				>
					<Terminal size={13} />
					{expanded ? "Hide Terminal" : "Show Terminal"}
				</button>
				{session.status === "running" && (
					<button
						onClick={handleStop}
						className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#ef4444] text-[11px] font-medium text-white hover:bg-red-500 transition-colors shrink-0"
					>
						<Square size={10} className="fill-current" />
						Stop
					</button>
				)}
			</div>
			{expanded && <RunTerminal key={workspaceId} workspaceId={workspaceId} className="h-48" />}
		</div>
	);
}
