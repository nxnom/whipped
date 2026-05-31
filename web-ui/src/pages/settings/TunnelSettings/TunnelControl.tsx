import { Loader2, Play, Square } from "lucide-react";
import { useEffect } from "react";
import { useRead, useWrite } from "@/runtime/api-client";
import { classNames } from "@/utils/classNames";
import { STATUS_STYLES } from "./constants";
import type { TunnelStatus } from "./types";

export function TunnelControl() {
	const { data: state, trigger: refreshStatus } = useRead((api) => api("slack/tunnelStatus").GET());

	const startTunnel = useWrite((api) => api("slack/startTunnel").POST());
	const stopTunnel = useWrite((api) => api("slack/stopTunnel").POST());

	// Poll the tunnel status every 3s (preserves the original setInterval cadence).
	useEffect(() => {
		const id = setInterval(() => {
			void refreshStatus();
		}, 3000);
		return () => clearInterval(id);
	}, [refreshStatus]);

	// startTunnel/stopTunnel are slack/* writes, so Spoosh auto-invalidates the
	// slack/tunnelStatus read; the 3s poll then tracks the starting→running step.
	const handleStart = () => void startTunnel.trigger({});
	const handleStop = () => void stopTunnel.trigger({});

	const status = (state?.status ?? "stopped") as TunnelStatus;
	const style = STATUS_STYLES[status];
	const isRunning = status === "running" || status === "starting";
	const acting = startTunnel.loading || stopTunnel.loading;

	return (
		<div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#0c0c0f] border border-[#2a2a35]">
			<div className="flex items-center gap-2 flex-1 min-w-0">
				{status === "starting" ? (
					<Loader2 size={8} className="animate-spin shrink-0" style={{ color: style.dot }} />
				) : (
					<div className="shrink-0 w-2 h-2 rounded-full" style={{ background: style.dot }} />
				)}
				<span className="text-[13px]" style={{ color: style.text }}>
					{style.label}
				</span>
				{state?.error && <span className="text-[11px] font-mono truncate text-[#60607a]">— {state.error}</span>}
			</div>
			<button
				onClick={isRunning ? handleStop : handleStart}
				disabled={acting}
				className={classNames(
					"flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium transition-opacity disabled:opacity-50 hover:opacity-80 shrink-0",
					isRunning
						? "bg-[#2a1a1a] border border-[#4a1a1a] text-[#f87171]"
						: "bg-[#1a2a1a] border border-[#1a4a1a] text-[#4ade80]",
				)}
			>
				{isRunning ? <Square size={11} /> : <Play size={11} />}
				{isRunning ? "Stop" : "Start"}
			</button>
		</div>
	);
}
