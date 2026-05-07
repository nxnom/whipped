import type { RuntimeStateEvent, RuntimeWorkspaceStateResponse } from "@runtime-contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/runtime/trpc-client";

export function useWorkspaceState(workspaceId: string) {
    const [state, setState] = useState<RuntimeWorkspaceStateResponse | null>(null);
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelayRef = useRef(1000);
    const mountedRef = useRef(true);

    const connect = useCallback(() => {
        if (!mountedRef.current) return;
        const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            if (ws !== wsRef.current || !mountedRef.current) { ws.close(); return; }
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
                        setState(msg.state);
                        break;
                    case "autonomous_mode_changed":
                        setState((prev) => (prev ? { ...prev, autonomousModeEnabled: msg.enabled } : prev));
                        break;
                }
            } catch {
                // ignore
            }
        };
    }, [workspaceId]);

    useEffect(() => {
        mountedRef.current = true;
        reconnectDelayRef.current = 1000;
        setState(null);
        connect();
        return () => {
            mountedRef.current = false;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            wsRef.current?.close();
            wsRef.current = null;
        };
    }, [workspaceId, connect]);

    const refetch = useCallback(async () => {
        const fresh = await trpc.workspace.state.query({ workspaceId });
        setState(fresh);
    }, [workspaceId]);

    const optimisticDeleteCard = useCallback((cardId: string) => {
        setState((prev) => {
            if (!prev) return prev;
            const { [cardId]: _, ...cards } = prev.board.cards;
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
        });
    }, []);

    return { state, connected, refetch, optimisticDeleteCard, ws: wsRef };
}
