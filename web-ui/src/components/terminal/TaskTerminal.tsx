import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "@/stores/theme-store";
import { classNames } from "@/utils/classNames";
import { xtermTheme } from "./xtermTheme";

interface TaskTerminalProps {
	taskId: string;
	workspaceId: string;
	className?: string;
}

export function TaskTerminal({ taskId, workspaceId, className }: TaskTerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const theme = useTheme();

	// Re-theme an already-mounted terminal instead of leaving it locked to
	// whatever was active when it connected — xterm resolves the theme once
	// into its own color state, so it doesn't pick up new CSS custom property
	// values on its own.
	useEffect(() => {
		if (termRef.current) termRef.current.options.theme = xtermTheme();
	}, [theme]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const term = new Terminal({
			theme: xtermTheme(),
			fontSize: 12,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			cursorBlink: true,
			scrollback: 50000,
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
		// connecting. The CLI draws its full-screen UI using absolute cursor
		// positioning sized to whatever `cols`/`rows` we send in the first resize
		// message — connecting (and sending that first resize) before the
		// container has its real pixel size means the CLI's first frame is drawn
		// assuming the wrong dimensions, and it doesn't always fully redraw when
		// a later resize corrects it, leaving stale/overlapping content behind.
		const raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => {
				if (disposed) return;
				fit.fit();

				const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
				const params = new URLSearchParams({ workspaceId, taskId });
				ws = new WebSocket(`${proto}//${window.location.host}/api/terminal?${params}`);
				const socket = ws;

				socket.addEventListener("open", () => {
					fit.fit();
					if (socket.readyState === WebSocket.OPEN) {
						socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
					}
				});

				socket.addEventListener("message", (event) => {
					if (typeof event.data === "string") {
						term.write(event.data);
					} else if (event.data instanceof ArrayBuffer) {
						term.write(new Uint8Array(event.data));
					}
				});

				socket.addEventListener("error", () => {
					term.write("\r\n\x1b[31m[terminal: connection failed — is the whipped server running?]\x1b[0m\r\n");
				});

				socket.addEventListener("close", (e) => {
					if (e.code !== 1000 && e.code !== 1001) {
						term.write(`\r\n\x1b[31m[terminal: disconnected (${e.code})]\x1b[0m\r\n`);
					}
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
						if (socket.readyState === WebSocket.OPEN) {
							socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
						}
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
	}, [taskId, workspaceId]);

	return <div ref={containerRef} className={classNames(className ?? "h-64", "overflow-hidden")} />;
}
