import { LoadingButton, Tooltip } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { Columns2, Maximize2, Minimize2, OctagonX, Play, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { useFullscreen } from "@/runtime/url-state";
import { classNames } from "@/utils/classNames";
import { CanvasPanelBody, CanvasPanelHeader, useCompanionCanvas } from "./canvas/CanvasPanel";
import { CompanionDiffPanel } from "./CompanionDiffPanel";

type DetailTab = "terminal" | "diff";

export function CompanionSessionDetail({
	session,
	workspaceId,
	onStopSession,
	onResumeSession,
	resuming,
}: {
	session: CompanionSession;
	workspaceId: string;
	onStopSession: () => void;
	onResumeSession: () => void;
	resuming: boolean;
}) {
	const [tab, setTab] = useState<DetailTab>("terminal");
	const canvas = useCompanionCanvas(session.id, workspaceId);

	const terminalHidden = tab !== "terminal" || canvas.open;
	const { fullscreen, setFullscreen } = useFullscreen();

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Tab bar — the canvas title/toggle shares this row instead of its own strip.
			    Fullscreen drops it along with the app's top/bottom bars, leaving the
			    terminal alone on screen. */}
			<div
				className={classNames(
					"flex items-center justify-between shrink-0 bg-whip-bg border-b border-whip-border pl-5 pr-3",
					fullscreen && "hidden",
				)}
			>
				<div className="flex">
					{(
						[
							{ id: "terminal" as const, label: "Terminal", Icon: TerminalSquare },
							{ id: "diff" as const, label: "Diff", Icon: Columns2 },
						] satisfies { id: DetailTab; label: string; Icon: typeof TerminalSquare }[]
					).map(({ id, label, Icon }) => (
						<button
							key={id}
							onClick={() => setTab(id)}
							className={classNames(
								"relative flex items-center gap-1.5 px-4 py-[11px] text-xs font-medium transition-colors",
								tab === id ? "text-whip-text" : "text-whip-faint hover:text-whip-muted",
							)}
						>
							<Icon size={11} />
							{label}
							{tab === id && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-whip-accent" />}
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					{tab === "terminal" && <CanvasPanelHeader canvas={canvas} />}
					{!terminalHidden && (
						<Tooltip delayDuration={0} content="Full screen terminal" placement="bottom" triggerAsChild>
							<span>
								<button
									onClick={() => setFullscreen(true)}
									className="flex items-center p-1.5 rounded-md text-whip-faint hover:text-whip-text transition-colors shrink-0"
								>
									<Maximize2 size={13} />
								</button>
							</span>
						</Tooltip>
					)}
					{session.status === "running" && (
						<Tooltip delayDuration={0} content="Kill this session" placement="bottom" triggerAsChild>
							<span>
								<button
									onClick={onStopSession}
									className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-whip-border bg-whip-panel text-xs font-semibold text-[#ff3b4d] hover:bg-[#ff3b4d]/10 transition-colors shrink-0"
								>
									<OctagonX size={13} />
									Kill
								</button>
							</span>
						</Tooltip>
					)}
				</div>
			</div>

			{/* Tab content — a companion session is a single persistent terminal stream,
			    keyed by session id, so the terminal always stays mounted underneath the
			    diff tab and the canvas (unmounting would drop scrollback and require
			    reconnecting). An open canvas takes the pane over entirely; the header's
			    Terminal toggle collapses it to bring the terminal back. */}
			<div className="flex-1 min-h-0 flex">
				<div className={classNames("group relative flex-1 min-h-0", terminalHidden && "hidden")}>
					<TaskTerminal key={session.id} taskId={session.id} workspaceId={workspaceId} className="absolute inset-0" />
					{/* Fullscreen leaves no chrome to exit from, so the way out is this
					    button — revealed on hover instead of always covering output. Esc is
					    deliberately not bound: the terminal owns that key. */}
					{fullscreen && (
						<button
							onClick={() => setFullscreen(false)}
							className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-whip-border bg-whip-panel text-xs font-semibold text-whip-muted opacity-0 group-hover:opacity-100 hover:text-whip-text transition-opacity"
						>
							<Minimize2 size={13} />
							Exit full screen
						</button>
					)}
					{/* Selecting a stopped session never auto-relaunches the agent — resuming
					    is an explicit choice since it opens the CLI's own picker/continue UI. */}
					{session.status === "stopped" && (
						<div className="absolute inset-0 flex items-center justify-center bg-whip-bg/70">
							<LoadingButton onClick={onResumeSession} loading={resuming} loadingText="Resuming...">
								<span className="flex items-center gap-1.5">
									<Play size={13} />
									Resume session
								</span>
							</LoadingButton>
						</div>
					)}
				</div>
				{tab === "terminal" && <CanvasPanelBody canvas={canvas} />}
				{tab === "diff" && <CompanionDiffPanel sessionId={session.id} />}
			</div>
		</div>
	);
}
