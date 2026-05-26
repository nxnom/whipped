import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

interface TaskTerminalProps {
	taskId: string;
	workspaceId: string;
	className?: string;
}

export function TaskTerminal({ taskId, workspaceId, className }: TaskTerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: {
				background: "#0a0a0e",
				foreground: "#d1d5db",
				cursor: "#60a5fa",
				selectionBackground: "#374151",
			},
			fontSize: 12,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			cursorBlink: true,
			scrollback: 50000,
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);

		// Fit once the container has settled in the layout
		requestAnimationFrame(() => requestAnimationFrame(() => fit.fit()));

		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const params = new URLSearchParams({ workspaceId, taskId });
		const ws = new WebSocket(`${proto}//${window.location.host}/api/terminal?${params}`);

		ws.addEventListener("open", () => {
			// Fit now that the connection is up — container is definitely laid out
			fit.fit();
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
			}
		});

		ws.addEventListener("message", (event) => {
			if (typeof event.data === "string") {
				term.write(event.data);
			} else if (event.data instanceof ArrayBuffer) {
				term.write(new Uint8Array(event.data));
			}
		});

		ws.addEventListener("error", () => {
			term.write("\r\n\x1b[31m[terminal: connection failed — is the overemployed server running?]\x1b[0m\r\n");
		});

		ws.addEventListener("close", (e) => {
			if (e.code !== 1000 && e.code !== 1001) {
				term.write(`\r\n\x1b[31m[terminal: disconnected (${e.code})]\x1b[0m\r\n`);
			}
		});

		const inputDisposable = term.onData((data) => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(data);
			}
		});

		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				resizeTimer = null;
				fit.fit();
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
				}
			}, 50);
		});
		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
			inputDisposable.dispose();
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			ws.close(1000);
			term.dispose();
		};
	}, [taskId, workspaceId]);

	return <div ref={containerRef} className={className ?? "h-64"} style={{ overflow: "hidden" }} />;
}
