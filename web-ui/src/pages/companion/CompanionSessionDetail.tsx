import { Tooltip } from "@geckoui/geckoui";
import type { CompanionSession } from "@runtime-contract";
import { Columns2, OctagonX, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { classNames } from "@/utils/classNames";
import { CanvasPanelBody, CanvasPanelHeader, useCompanionCanvas } from "./canvas/CanvasPanel";
import { CompanionDiffPanel } from "./CompanionDiffPanel";

type DetailTab = "terminal" | "diff";

export function CompanionSessionDetail({
	session,
	workspaceId,
	onStopSession,
}: {
	session: CompanionSession;
	workspaceId: string;
	onStopSession: () => void;
}) {
	const [tab, setTab] = useState<DetailTab>("terminal");
	const canvas = useCompanionCanvas(session.id, workspaceId);

	return (
		<div className="flex-1 flex flex-col min-h-0 overflow-hidden">
			{/* Tab bar — canvas title/version-selector shares this row instead of its own strip */}
			<div className="flex items-center justify-between shrink-0 bg-whip-bg border-b border-whip-border pl-5 pr-3">
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
					{session.status === "running" && (
						<Tooltip delayDuration={0} content="Kill this session" side="bottom" triggerAsChild>
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
			    diff tab (unmounting would drop scrollback and require reconnecting). */}
			<div className="flex-1 min-h-0 flex">
				<TaskTerminal
					key={session.id}
					taskId={session.id}
					workspaceId={workspaceId}
					className={classNames("flex-1 min-h-0", tab !== "terminal" && "hidden")}
				/>
				{tab === "terminal" && (
					<CanvasPanelBody sessionId={session.id} canvas={canvas} readOnly={session.status !== "running"} />
				)}
				{tab === "diff" && <CompanionDiffPanel sessionId={session.id} />}
			</div>
		</div>
	);
}
