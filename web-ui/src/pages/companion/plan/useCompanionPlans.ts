import type { RuntimeStateEvent } from "@runtime-contract";
import { useCallback, useEffect, useRef } from "react";
import { optimistic, useRead, useWrite } from "@/runtime/api-client";

// Mirrors useRunSession's WS-subscription pattern: its own /ws connection,
// subscribes once, and patches the Spoosh cache directly on a matching event —
// no polling, no refetch on the happy path.
export function useCompanionPlans(workspaceId: string, sessionId: string) {
	const { data, trigger: refetch } = useRead((api) =>
		api("companion-sessions/:id/plans").GET({ params: { id: sessionId } }),
	);
	const wsRef = useRef<WebSocket | null>(null);
	const mountedRef = useRef(true);

	const refetchRef = useRef(refetch);
	refetchRef.current = refetch;

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
			refetchRef.current();
		};

		ws.onmessage = (event) => {
			if (ws !== wsRef.current) return;
			try {
				const msg = JSON.parse(event.data as string) as RuntimeStateEvent;
				if (msg.type === "companion_plan_updated" && msg.sessionId === sessionId) {
					optimistic((cache) =>
						cache("companion-sessions/:id/plans")
							.filter((entry) => entry.params.id === sessionId)
							.set((current) => ({ plans: [msg.plan, ...(current?.plans ?? [])] })),
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
	}, [workspaceId, sessionId]);

	useEffect(() => {
		mountedRef.current = true;
		connect();
		return () => {
			mountedRef.current = false;
			wsRef.current?.close();
			wsRef.current = null;
		};
	}, [connect]);

	const { trigger: sendPlanFeedbackTrigger } = useWrite((api) => api("terminal/input").POST());

	const sendFeedback = useCallback(
		async (composedText: string) => {
			const wrapped = `\x1b[200~${composedText}\x1b[201~\r`;
			await sendPlanFeedbackTrigger({ body: { workspaceId, taskId: sessionId, data: wrapped } });
		},
		[sendPlanFeedbackTrigger, workspaceId, sessionId],
	);

	return { plans: data?.plans ?? [], sendFeedback };
}
