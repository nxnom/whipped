import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { classNames } from "@/utils/classNames";
import { XTERM_THEME } from "./xtermTheme";

interface RunTerminalProps {
	workspaceId: string;
	className?: string;
}

export function RunTerminal({ workspaceId, className }: RunTerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: XTERM_THEME,
			fontSize: 12,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			cursorBlink: true,
			scrollback: 10000,
		});
		termRef.current = term;

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(container);

		let disposed = false;
		let ws: WebSocket | null = null;
		let inputDisposable: { dispose(): void } | null = null;
		let resizeObserver: ResizeObserver | null = null;
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		let raf2 = 0;

		// Wait for the container to settle into its final layout size before
		// connecting — fitting after the buffer replay has already started can
		// leave the terminal sized wrong for the content it just received.
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => {
				if (disposed) return;
				fit.fit();

				const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
				ws = new WebSocket(
					`${proto}//${window.location.host}/api/run-terminal?workspaceId=${encodeURIComponent(workspaceId)}`,
				);
				const socket = ws;

				socket.addEventListener("open", () => {
					fit.fit();
				});

				socket.addEventListener("message", (event) => {
					if (typeof event.data === "string") term.write(event.data);
					else if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data));
				});

				socket.addEventListener("error", () => {
					term.write("\r\n\x1b[31m[run terminal: connection failed]\x1b[0m\r\n");
				});

				inputDisposable = term.onData((data) => {
					if (socket.readyState === WebSocket.OPEN) {
						socket.send(data);
					}
				});

				resizeObserver = new ResizeObserver(() => {
					if (resizeTimer !== null) clearTimeout(resizeTimer);
					resizeTimer = setTimeout(() => {
						resizeTimer = null;
						fit.fit();
					}, 50);
				});
				resizeObserver.observe(container);
			});
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
			resizeObserver?.disconnect();
			inputDisposable?.dispose();
			if (resizeTimer !== null) clearTimeout(resizeTimer);
			ws?.close(1000);
			term.dispose();
			termRef.current = null;
		};
	}, [workspaceId]);

	return (
		<div
			ref={containerRef}
			className={classNames(className ?? "h-40", "overflow-hidden")}
			style={{ background: XTERM_THEME.background }}
		/>
	);
}
