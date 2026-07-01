import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { classNames } from "@/utils/classNames";
import { xtermTheme } from "./xtermTheme";

interface RunTerminalProps {
	workspaceId: string;
	className?: string;
}

export function RunTerminal({ workspaceId, className }: RunTerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: xtermTheme(),
			fontSize: 12,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			cursorBlink: true,
			scrollback: 10000,
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);
		requestAnimationFrame(() => requestAnimationFrame(() => fit.fit()));

		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(
			`${proto}//${window.location.host}/api/run-terminal?workspaceId=${encodeURIComponent(workspaceId)}`,
		);

		ws.addEventListener("open", () => {
			fit.fit();
		});

		ws.addEventListener("message", (event) => {
			if (typeof event.data === "string") term.write(event.data);
			else if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data));
		});

		ws.addEventListener("error", () => {
			term.write("\r\n\x1b[31m[run terminal: connection failed]\x1b[0m\r\n");
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
	}, [workspaceId]);

	return <div ref={containerRef} className={classNames(className ?? "h-40", "overflow-hidden")} />;
}
