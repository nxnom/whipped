import { Button } from "@geckoui/geckoui";
import { Bot, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";
import { classNames } from "@/utils/classNames";

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 520;

interface Props {
	workspaceId: string;
	open: boolean;
	onClose: () => void;
}

export function AssistantPanel({ workspaceId, open, onClose }: Props) {
	const [taskId, setTaskId] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);
	const startingRef = useRef(false);
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	const onDragStart = (e: React.MouseEvent) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		const onMove = (ev: MouseEvent) => {
			if (!dragRef.current) return;
			// Dragging left increases width (panel is on the right)
			const delta = dragRef.current.startX - ev.clientX;
			setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
		};
		const onUp = () => {
			dragRef.current = null;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

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
		return () => {
			cancelled = true;
		};
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
		<div className={classNames("shrink-0 flex overflow-hidden", !open && "hidden")} style={{ width }}>
			{/* Drag handle */}
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-[#7c6aff]/40 active:bg-[#7c6aff]/60 transition-colors bg-[#2a2a35]"
			/>
			<div className="flex-1 border-l border-[#2a2a35] flex flex-col overflow-hidden">
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a35] shrink-0">
					<div className="flex items-center gap-2">
						<Bot size={16} className="text-[#7c6aff]" />
						<h2 className="text-sm font-medium text-[#f0f0f5]">Assistant</h2>
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
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#60607a]">
							<Bot size={40} />
							<p className="text-sm">Interactive Claude session for managing your board</p>
							<Button size="sm" onClick={() => void startSession()} disabled={starting}>
								{starting ? "Starting..." : "Start Session"}
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
