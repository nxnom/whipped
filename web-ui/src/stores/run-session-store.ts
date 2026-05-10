import type { RunSessionStatus, RuntimeStateEvent } from "@runtime-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

export interface RunSessionState {
	cardId: string | null;
	status: RunSessionStatus | "stopped";
	errorMessage?: string;
}

export function useRunSession(workspaceId: string) {
	const [session, setSession] = useState<RunSessionState>({ cardId: null, status: "stopped" });
	const wsRef = useRef<WebSocket | null>(null);
	const mountedRef = useRef(true);

	// Load initial state via tRPC
	useEffect(() => {
		trpc.run.status.query({ workspaceId }).then((s) => {
			if (mountedRef.current) setSession({ cardId: s.cardId, status: s.status, errorMessage: "errorMessage" in s ? s.errorMessage : undefined });
		}).catch(() => {});
	}, [workspaceId]);

	// Subscribe to workspace WebSocket for live updates
	const connect = useCallback(() => {
		if (!mountedRef.current) return;
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		wsRef.current = ws;

		ws.onopen = () => {
			if (ws !== wsRef.current || !mountedRef.current) { ws.close(); return; }
			ws.send(JSON.stringify({ type: "subscribe", workspaceId }));
			// Re-sync run status on every (re)connect in case server restarted
			trpc.run.status.query({ workspaceId }).then((s) => {
				if (mountedRef.current) setSession({ cardId: s.cardId, status: s.status, errorMessage: "errorMessage" in s ? s.errorMessage : undefined });
			}).catch(() => {});
		};

		ws.onmessage = (event) => {
			if (ws !== wsRef.current) return;
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				if (msg.type === "run_session_changed") {
					setSession({ cardId: msg.cardId, status: msg.status, errorMessage: msg.errorMessage });
				}
			} catch { /* ignore */ }
		};

		ws.onclose = () => {
			if (ws !== wsRef.current || !mountedRef.current) return;
			setTimeout(() => { if (mountedRef.current) connect(); }, 2000);
		};
	}, [workspaceId]);

	useEffect(() => {
		mountedRef.current = true;
		connect();
		return () => {
			mountedRef.current = false;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [workspaceId, connect]);

	const start = useCallback(async (cardId: string) => {
		await trpc.run.start.mutate({ workspaceId, cardId });
	}, [workspaceId]);

	const stop = useCallback(async () => {
		await trpc.run.stop.mutate({ workspaceId });
	}, [workspaceId]);

	return { session, start, stop };
}
