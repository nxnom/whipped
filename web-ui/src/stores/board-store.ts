import type { RuntimeStateEvent, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiSchema } from "@/runtime/api-client";
import { optimistic, useRead } from "@/runtime/api-client";

// Spoosh caches Hono's JSON-serialized shape, which differs from the raw
// contract type only at the serialization boundary (e.g. `unknown` → JSONValue).
type WorkspaceStateData = ApiSchema["workspace/state"]["GET"]["data"];

export function useWorkspaceState(workspaceId: string) {
	const { data, trigger: refetch } = useRead((api) => api("workspace/state").GET({ query: { workspaceId } }));
	const [connected, setConnected] = useState(false);
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectDelayRef = useRef(1000);
	const mountedRef = useRef(true);

	// Push a full state snapshot from the WebSocket straight into the Spoosh
	// cache for this workspace's query — no refetch (the message already carries it).
	const applyState = useCallback(
		(next: RuntimeWorkspaceStateResponse) => {
			optimistic((cache) =>
				cache("workspace/state")
					.filter((entry) => entry.query.workspaceId === workspaceId)
					.set(() => next as unknown as WorkspaceStateData),
			);
		},
		[workspaceId],
	);

	const connect = useCallback(() => {
		if (!mountedRef.current) return;
		const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
			if (ws !== wsRef.current || !mountedRef.current) {
				ws.close();
				return;
			}
			reconnectDelayRef.current = 1000; // reset backoff on success
			setConnected(true);
			ws.send(JSON.stringify({ type: "subscribe", workspaceId }));
		};

		ws.onclose = () => {
			if (ws !== wsRef.current || !mountedRef.current) return;
			setConnected(false);
			const delay = reconnectDelayRef.current;
			reconnectDelayRef.current = Math.min(delay * 2, 30000); // cap at 30s
			reconnectTimerRef.current = setTimeout(() => {
				if (mountedRef.current) connect();
			}, delay);
		};

		ws.onmessage = (event) => {
			if (ws !== wsRef.current) return;
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				switch (msg.type) {
					case "snapshot":
					case "workspace_updated":
						applyState(msg.state);
						break;
					case "autonomous_mode_changed":
						optimistic((cache) =>
							cache("workspace/state")
								.filter((entry) => entry.query.workspaceId === workspaceId)
								.set((prev) => (prev ? { ...prev, autonomousModeEnabled: msg.enabled } : prev)),
						);
						break;
				}
			} catch {
				// ignore
			}
		};
	}, [workspaceId, applyState]);

	useEffect(() => {
		mountedRef.current = true;
		reconnectDelayRef.current = 1000;
		connect();
		return () => {
			mountedRef.current = false;
			if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connect]);

	const optimisticDeleteCard = useCallback(
		(cardId: string) => {
			optimistic((cache) =>
				cache("workspace/state")
					.filter((entry) => entry.query.workspaceId === workspaceId)
					.set((prev) => {
						if (!prev) return prev;
						const { [cardId]: _removed, ...cards } = prev.board.cards;
						return {
							...prev,
							board: {
								...prev.board,
								cards,
								columns: prev.board.columns.map((col) => ({
									...col,
									taskIds: col.taskIds.filter((id) => id !== cardId),
								})),
							},
						};
					}),
			);
		},
		[workspaceId],
	);

	// Consumers are written against the contract type; the inferred (serialized)
	// cache type widens to it cleanly.
	const state: RuntimeWorkspaceStateResponse | null = data ?? null;

	return { state, connected, refetch, optimisticDeleteCard, ws: wsRef };
}
