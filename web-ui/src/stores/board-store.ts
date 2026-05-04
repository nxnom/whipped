import type { RuntimeStateEvent, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

export function useWorkspaceState(workspaceId: string) {
	const [state, setState] = useState<RuntimeWorkspaceStateResponse | null>(null);
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);

	useEffect(() => {
		setState(null);
		const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			setConnected(true);
			ws.send(JSON.stringify({ type: "subscribe", workspaceId }));
		};
		ws.onclose = () => setConnected(false);

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				switch (msg.type) {
					case "snapshot":
					case "workspace_updated":
						setState(msg.state);
						break;
					case "session_updated":
						setState((prev) => (prev ? { ...prev, sessions: { ...prev.sessions, [msg.taskId]: msg.session } } : prev));
						break;
					case "autonomous_mode_changed":
						setState((prev) => (prev ? { ...prev, autonomousModeEnabled: msg.enabled } : prev));
						break;
				}
			} catch {
				// ignore
			}
		};

		return () => {
			ws.close();
			wsRef.current = null;
		};
	}, [workspaceId]);

	const refetch = useCallback(async () => {
		const fresh = await trpc.workspace.state.query({ workspaceId });
		setState(fresh);
	}, [workspaceId]);

	return { state, connected, refetch, ws: wsRef };
}
