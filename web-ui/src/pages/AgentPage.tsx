import { Button } from "@geckoui/geckoui";
import { Bot, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { useRead, useWrite } from "@/runtime/api-client";

interface Props {
	workspaceId: string;
}

export function AgentPage({ workspaceId }: Props) {
	const [taskId, setTaskId] = useState<string | null>(null);
	const [starting, setStarting] = useState(false);

	const { trigger: fetchSessionStatus } = useRead((api) => api("agent/session").GET({ query: { workspaceId } }), {
		enabled: false,
	});
	const { trigger: startSessionRequest } = useWrite((api) => api("agent/session").POST());
	const { trigger: stopSessionRequest } = useWrite((api) => api("agent/session").DELETE());

	useEffect(() => {
		// Check if a session is already running when we mount
		fetchSessionStatus()
			.then(({ data: status }) => {
				if (status?.running && status.taskId) {
					setTaskId(status.taskId);
				}
			})
			.catch((err) => console.warn("[AgentPage] Failed to load session status:", err));
	}, [workspaceId]);

	const startSession = async () => {
		setStarting(true);
		try {
			const { data: result } = await startSessionRequest({ body: { workspaceId } });
			setTaskId(result?.taskId ?? null);
		} finally {
			setStarting(false);
		}
	};

	const stopSession = async () => {
		await stopSessionRequest({ query: { workspaceId } });
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
