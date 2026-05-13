import { Button } from "@geckoui/geckoui";
import { Bot, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { trpc } from "@/runtime/trpc-client";

interface Props {
	workspaceId: string;
}

export function AgentPage({ workspaceId }: Props) {
	const [taskId, setTaskId] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);

	useEffect(() => {
		// Check if a session is already running when we mount
		trpc.agent.sessionStatus
			.query({ workspaceId })
			.then((status) => {
				if (status.running && status.taskId) {
					setTaskId(status.taskId);
				}
			})
			.catch((err) => console.warn("[AgentPage] Failed to load session status:", err));
	}, [workspaceId]);

	const startSession = async () => {
		setStarting(true);
		try {
			const result = await trpc.agent.startSession.mutate({ workspaceId });
			setTaskId(result.taskId);
		} finally {
			setStarting(false);
		}
	};

	const stopSession = async () => {
		await trpc.agent.stopSession.mutate({ workspaceId });
		setTaskId(null);
	};

	return (
		<div className="flex-1 overflow-hidden flex flex-col">
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
				<div className="flex items-center gap-2">
					<Bot size={16} className="text-blue-400" />
					<h2 className="text-sm font-medium text-gray-300">Assistant</h2>
				</div>
				<div className="flex items-center gap-2">
					{taskId && (
						<>
							<Button variant="ghost" size="sm" onClick={() => void startSession()}>
								<RefreshCw size={13} className="mr-1" /> Restart
							</Button>
							<Button variant="ghost" size="sm" onClick={() => void stopSession()}>
								<Square size={13} className="mr-1" /> Stop
							</Button>
						</>
					)}
				</div>
			</div>

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
	);
}
