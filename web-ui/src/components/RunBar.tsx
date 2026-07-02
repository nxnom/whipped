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
			<span className="size-2 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
		) : session.status === "error" ? (
			<span className="size-2 rounded-full bg-[#ff3b4d] shrink-0" />
		) : (
			<span className="size-2 rounded-full bg-[#5f6672] shrink-0" />
		);

	const statusLabel = session.status === "running" ? "Running" : session.status === "error" ? "Crashed" : "Stopped";

	return (
		<div className="shrink-0 border-t border-whip-border bg-whip-surface flex flex-col">
			<div className="flex items-center gap-2.5 px-5 py-2">
				<div className="flex items-center gap-1.5 shrink-0">
					{statusDot}
					<span
						className={classNames(
							"text-[11px] font-semibold",
							session.status === "running"
								? "text-whip-text"
								: session.status === "error"
									? "text-[#ff3b4d]"
									: "text-whip-muted",
						)}
					>
						{statusLabel}
					</span>
				</div>
				<div className="w-px h-4 bg-whip-border shrink-0" />
				<span className="text-[11px] font-medium text-whip-text truncate flex-1 min-w-0">{title}</span>
				{cardAgentId &&
					(() => {
						const colors: Record<string, { dot: string; text: string; bg: string }> = {
							claude: { dot: "bg-[#8b5cf6]", text: "text-[#8b5cf6]", bg: "bg-[#8b5cf6]/10" },
							codex: { dot: "bg-[#22c55e]", text: "text-[#22c55e]", bg: "bg-[#22c55e]/10" },
							cursor: { dot: "bg-[#3b82f6]", text: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10" },
							opencode: { dot: "bg-[#f97316]", text: "text-[#f97316]", bg: "bg-[#f97316]/10" },
							mimo: { dot: "bg-[#fb8147]", text: "text-[#fb8147]", bg: "bg-[#fb8147]/10" },
						};
						const ac = colors[cardAgentId] ?? { dot: "bg-[#5f6672]", text: "text-whip-muted", bg: "bg-[#5f6672]/10" };
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
					<span className="text-[11px] text-[#ff3b4d] truncate max-w-xs shrink-0">{session.errorMessage}</span>
				)}
				<button
					onClick={() => setExpanded((v) => !v)}
					className="flex items-center gap-1 text-[11px] text-whip-faint hover:text-whip-muted transition-colors shrink-0"
				>
					<Terminal size={13} />
					{expanded ? "Hide Terminal" : "Show Terminal"}
				</button>
				{session.status === "running" && (
					<button
						onClick={handleStop}
						className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#ff3b4d] text-[11px] font-medium text-white hover:bg-[#e0293a] transition-colors shrink-0"
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
