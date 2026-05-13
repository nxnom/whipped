import { ChevronDown, ChevronUp, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@geckoui/geckoui";
import { RunTerminal } from "@/components/terminal/RunTerminal";
import { useRunSession } from "@/stores/run-session-store";
import { trpc } from "@/runtime/trpc-client";

interface RunBarProps {
	workspaceId: string;
}

export function RunBar({ workspaceId }: RunBarProps) {
	const { session, stop } = useRunSession(workspaceId);
	const [expanded, setExpanded] = useState(true);
	const [cardTitle, setCardTitle] = useState<string | null>(null);

	useEffect(() => {
		if (!session.cardId) {
			setCardTitle(null);
			return;
		}
		trpc.workspace.state
			.query({ workspaceId })
			.then((s) => setCardTitle(s.board.cards[session.cardId!]?.title ?? session.cardId!))
			.catch(() => setCardTitle(session.cardId));
	}, [session.cardId, workspaceId]);

	const isVisible =
		session.status === "running" ||
		session.status === "error" ||
		(session.status === "stopped" && session.cardId !== null);
	if (!isVisible) return null;

	const title = cardTitle ?? session.cardId ?? "Unknown ticket";

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
		<div className="shrink-0 border-t border-gray-800 bg-gray-950 flex flex-col">
			{/* Bar header */}
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/60">
				{statusDot}
				<span className="text-xs font-medium text-gray-300 truncate flex-1">
					{statusLabel}: <span className="text-gray-400">{title}</span>
				</span>
				{session.status === "error" && session.errorMessage && (
					<span className="text-xs text-red-400 truncate max-w-xs">{session.errorMessage}</span>
				)}
				{session.status === "running" && (
					<button
						onClick={handleStop}
						title="Stop"
						className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-red-400 hover:bg-red-400/10 border border-red-400/20 transition-colors"
					>
						<Square size={10} className="fill-current" /> Stop
					</button>
				)}
				<button
					onClick={() => setExpanded((v) => !v)}
					className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
					title={expanded ? "Collapse" : "Expand"}
				>
					{expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
				</button>
			</div>

			{/* Terminal output */}
			{expanded && <RunTerminal key={workspaceId} workspaceId={workspaceId} className="h-48" />}
		</div>
	);
}
