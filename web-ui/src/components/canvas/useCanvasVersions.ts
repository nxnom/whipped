import type { RuntimeStateEvent } from "@runtime-contract";
import { useCallback, useEffect, useRef } from "react";
import { optimistic, useRead, useWrite } from "@/runtime/api-client";

// Gap between writing the pasted feedback and pressing Enter — sent as two
// separate PTY writes rather than one. Bundling `\r` onto the same write as
// the bracketed-paste content raced the receiving CLI's paste handling for
// long messages: Enter could land before the TUI finished processing the
// paste into its input buffer, so it got swallowed and the text just sat
// there unsubmitted. A short pause between the two writes lets that settle.
const SUBMIT_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirrors useRunSession's WS-subscription pattern: its own /ws connection,
// subscribes once, and patches the Spoosh cache directly on a matching event —
// no polling, no refetch on the happy path. Shared by the companion agent
// (sessionId is a real companion session id) and the assistant agent
// (sessionId is its synthetic per-workspace id) — sessionId may be empty
// before an assistant session exists, in which case this stays idle (no
// fetch, no socket) rather than fetching canvases for a nonsense id.
export function useCanvasVersions(workspaceId: string, sessionId: string) {
	const enabled = Boolean(sessionId);
	const { data, trigger: refetch } = useRead(
		(api) => api("companion-sessions/:id/canvases").GET({ params: { id: sessionId } }),
		{ enabled },
	);
	const wsRef = useRef<WebSocket | null>(null);
	const mountedRef = useRef(true);

	const refetchRef = useRef(refetch);
	refetchRef.current = refetch;

	const connect = useCallback(() => {
		if (!mountedRef.current || !enabled) return;
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		wsRef.current = ws;

		ws.onopen = () => {
			if (ws !== wsRef.current || !mountedRef.current) {
				ws.close();
				return;
			}
			ws.send(JSON.stringify({ type: "subscribe", workspaceId }));
			refetchRef.current();
		};

		ws.onmessage = (event) => {
			if (ws !== wsRef.current) return;
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				if (msg.type === "companion_canvas_updated" && msg.sessionId === sessionId) {
					optimistic((cache) =>
						cache("companion-sessions/:id/canvases")
							.filter((entry) => entry.params.id === sessionId)
							.set((current) => ({ canvases: [msg.canvas, ...(current?.canvases ?? [])] })),
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
	}, [workspaceId, sessionId, enabled]);

	useEffect(() => {
		mountedRef.current = true;
		connect();
		return () => {
			mountedRef.current = false;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connect]);

	const { trigger: sendCanvasFeedbackTrigger } = useWrite((api) => api("terminal/input").POST());

	const sendFeedback = useCallback(
		async (composedText: string) => {
			const wrapped = `\x1b[200~${composedText}\x1b[201~`;
			await sendCanvasFeedbackTrigger({ body: { workspaceId, taskId: sessionId, data: wrapped } });
			await sleep(SUBMIT_DELAY_MS);
			await sendCanvasFeedbackTrigger({ body: { workspaceId, taskId: sessionId, data: "\r" } });
		},
		[sendCanvasFeedbackTrigger, workspaceId, sessionId],
	);

	return { canvases: data?.canvases ?? [], sendFeedback };
}
