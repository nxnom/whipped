import type { RunSessionStatus, RuntimeStateEvent } from "@runtime-contract";
import { useCallback, useEffect, useRef } from "react";
import { optimistic, useRead, useWrite } from "@/runtime/api-client";

export interface RunSessionState {
	cardId: string | null;
	status: RunSessionStatus | "stopped";
	errorMessage?: string;
}

export function useRunSession(workspaceId: string) {
	const { data, trigger: refetchStatus } = useRead((api) => api("run/status").GET({ query: { workspaceId } }));
	const wsRef = useRef<WebSocket | null>(null);
	const mountedRef = useRef(true);

	// Hold the latest trigger in a ref so the WebSocket effect depends only on
	// workspaceId. The trigger's identity changes every render, so depending on
	// it directly would tear down and re-open the socket each render (request storm).
	const refetchRef = useRef(refetchStatus);
	refetchRef.current = refetchStatus;

	const connect = useCallback(() => {
		if (!mountedRef.current) return;
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		wsRef.current = ws;

		ws.onopen = () => {
			if (ws !== wsRef.current || !mountedRef.current) {
				ws.close();
				return;
			}
			ws.send(JSON.stringify({ type: "subscribe", workspaceId }));
			// Re-sync run status on every (re)connect in case the server restarted
			refetchRef.current();
		};

		ws.onmessage = (event) => {
			if (ws !== wsRef.current) return;
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				if (msg.type === "run_session_changed") {
					optimistic((cache) =>
						cache("run/status")
							.filter((entry) => entry.query.workspaceId === workspaceId)
							.set(() => ({ cardId: msg.cardId, status: msg.status, errorMessage: msg.errorMessage })),
					);
				}
			} catch {
				/* ignore */
			}
		};

		ws.onclose = () => {
			if (ws !== wsRef.current || !mountedRef.current) return;
			setTimeout(() => {
				if (mountedRef.current) connect();
			}, 2000);
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
	}, [connect]);

	const { trigger: startTrigger } = useWrite((api) => api("run/start").POST());
	const { trigger: startBaseTrigger } = useWrite((api) => api("run/start-base").POST());
	const { trigger: stopTrigger } = useWrite((api) => api("run/stop").POST());

	const start = useCallback(
		async (cardId: string) => {
			await startTrigger({ body: { workspaceId, cardId } });
		},
		[startTrigger, workspaceId],
	);

	const startBase = useCallback(async () => {
		await startBaseTrigger({ body: { workspaceId } });
	}, [startBaseTrigger, workspaceId]);

	const stop = useCallback(async () => {
		await stopTrigger({ body: { workspaceId } });
	}, [stopTrigger, workspaceId]);

	const session: RunSessionState = data
		? { cardId: data.cardId, status: data.status, errorMessage: "errorMessage" in data ? data.errorMessage : undefined }
		: { cardId: null, status: "stopped" };

	return { session, start, startBase, stop };
}
