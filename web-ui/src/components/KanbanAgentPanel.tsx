import { Button } from "@geckoui/geckoui";
import { Bot, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	workspaceId: string;
	open: boolean;
	onClose: () => void;
}

export function KanbanAgentPanel({ workspaceId, open, onClose }: Props) {
	const [taskId, setTaskId] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const startingRef = useRef(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;

		const doStart = async () => {
			if (startingRef.current) return;
			startingRef.current = true;
			setStarting(true);
			try {
				const result = await trpc.agent.startSession.mutate({ workspaceId });
				if (cancelled) {
					await trpc.agent.stopSession.mutate({ workspaceId }).catch(() => {});
					return;
				}
				setTaskId(result.taskId);
			} finally {
				startingRef.current = false;
				if (!cancelled) setStarting(false);
			}
		};

		const init = async () => {
			try {
				const status = await trpc.agent.sessionStatus.query({ workspaceId });
				if (cancelled) return;
				if (status.running && status.taskId) {
					setTaskId(status.taskId);
				} else {
					await doStart();
				}
			} catch {
				if (!cancelled) await doStart();
			}
		};

		void init();
		return () => { cancelled = true; };
	}, [open, workspaceId]);

	const startSession = async () => {
		if (startingRef.current) return;
		startingRef.current = true;
		setStarting(true);
		try {
			const result = await trpc.agent.startSession.mutate({ workspaceId });
			setTaskId(result.taskId);
		} finally {
			startingRef.current = false;
			setStarting(false);
		}
	};

	const stopSession = async () => {
		await trpc.agent.stopSession.mutate({ workspaceId }).catch(() => {});
		setTaskId(null);
		onClose();
	};

	const handleClose = () => onClose();

	return (
		<div className={`w-96 shrink-0 border-l border-gray-800 flex flex-col overflow-hidden ${open ? "" : "hidden"}`}>
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
				<div className="flex items-center gap-2">
					<Bot size={16} className="text-blue-400" />
					<h2 className="text-sm font-medium text-gray-300">Kanban Agent</h2>
				</div>
				<div className="flex items-center gap-2">
					{taskId && (
						<Button variant="ghost" size="sm" onClick={() => void stopSession()}>
							<Square size={13} className="mr-1" /> Stop
						</Button>
					)}
					<Button variant="ghost" size="sm" onClick={handleClose}>
						<X size={14} />
					</Button>
				</div>
			</div>

			<div className="flex-1 min-h-0 flex flex-col">
				{taskId ? (
					<TaskTerminal taskId={taskId} workspaceId={workspaceId} className="flex-1 min-h-0" />
				) : (
					<div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
						<Bot size={40} />
						<p className="text-sm">Interactive Claude session for managing your board</p>
						<Button size="sm" onClick={() => void startSession()} disabled={starting}>
							{starting ? "Starting..." : "Start Session"}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
