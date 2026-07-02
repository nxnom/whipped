import { Tooltip } from "@geckoui/geckoui";
import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Square } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { SESSION_TYPE_LABELS, sessionStatus, slotDuration } from "./constants";

type TerminalSession = NonNullable<RuntimeBoardCard["terminalSessions"]>[number];

interface WorkflowPipelineProps {
	sessions: TerminalSession[];
	workflowSlots?: WorkflowSlot[];
	activeStreamId: string;
	onSelectSession: (streamId: string) => void;
	sidebarCollapsed: boolean;
	onToggleCollapsed: () => void;
	onStop: () => void;
}

export function WorkflowPipeline({
	sessions,
	workflowSlots,
	activeStreamId,
	onSelectSession,
	sidebarCollapsed,
	onToggleCollapsed,
	onStop,
}: WorkflowPipelineProps) {
	return (
		<div className="shrink-0">
			{sidebarCollapsed ? (
				/* Collapsed: circular step rail, chevron leads the column */
				<div className="flex flex-col items-center pt-3.5 pb-4 gap-3">
					<button
						onClick={onToggleCollapsed}
						className="text-whip-faint hover:text-whip-muted transition-colors"
						title="Expand sidebar"
					>
						<ChevronLeft size={14} />
					</button>
					{sessions.length > 0 ? (
						sessions.map((session, idx) => {
							const slotName =
								workflowSlots?.find((s) => s.id === session.type)?.name ??
								SESSION_TYPE_LABELS[session.type] ??
								session.type;
							const status = sessionStatus(session);
							const isFocused = activeStreamId === session.streamId;
							return (
								<div key={session.streamId} className="flex flex-col items-center">
									<Tooltip content={slotName} side="left" triggerAsChild>
										<button
											onClick={() => onSelectSession(session.streamId)}
											className={classNames(
												"size-[30px] rounded-full flex items-center justify-center cursor-pointer transition-colors",
												status === "running"
													? "bg-whip-text/12 hover:bg-[#ff3b4d]/10"
													: isFocused
														? "bg-whip-text/12"
														: "hover:bg-white/[0.05]",
											)}
										>
											{status === "completed" && <Check size={14} className="text-[#22c55e]" />}
											{status === "running" && <Loader2 size={14} className="text-whip-text animate-spin" />}
											{status === "failed" && <Circle size={14} className="text-[#ff3b4d]" />}
											{status === "stopped" && <Circle size={14} className="text-[#eab308]" />}
										</button>
									</Tooltip>
									{idx < sessions.length - 1 && (
										<div
											className={classNames(
												"w-px h-[18px]",
												status === "completed" ? "bg-[#22c55e]/40" : "bg-whip-border",
											)}
										/>
									)}
								</div>
							);
						})
					) : (
						<div className="size-2 rounded-full bg-whip-border mt-1" />
					)}
				</div>
			) : (
				<div className="pt-3.5 pb-2 flex items-center px-[18px]">
					<span className="text-[11px] font-semibold text-whip-muted tracking-[0.3px] flex-1">Workflow Pipeline</span>
					<button
						onClick={onToggleCollapsed}
						className="text-whip-faint hover:text-whip-muted transition-colors"
						title="Collapse sidebar"
					>
						<ChevronRight size={14} />
					</button>
				</div>
			)}
			{!sidebarCollapsed && (
				/* Expanded: full rows */
				<div className="flex flex-col px-[18px] pb-4 max-h-72 overflow-y-auto">
					{sessions.length > 0 ? (
						sessions.map((session, idx) => {
							const slotName =
								workflowSlots?.find((s) => s.id === session.type)?.name ??
								SESSION_TYPE_LABELS[session.type] ??
								session.type;
							const status = sessionStatus(session);
							const duration = slotDuration(session.startedAt, session.endedAt);
							const isFocused = activeStreamId === session.streamId;
							return (
								<div
									key={session.streamId}
									className={classNames(
										"flex items-stretch gap-0 group rounded transition-colors",
										isFocused ? "bg-[#8b5cf6]/8" : "hover:bg-white/[0.03]",
									)}
								>
									<div
										className={classNames(
											"w-0.5 shrink-0 rounded-full mr-2 self-stretch transition-colors",
											isFocused ? "bg-[#8b5cf6]" : "bg-transparent",
										)}
									/>
									<div className="flex flex-col items-center w-7 shrink-0">
										{status === "running" ? (
											<button
												onClick={(e) => {
													e.stopPropagation();
													onStop();
												}}
												title="Stop agent"
												className="size-6 rounded-full flex items-center justify-center shrink-0 bg-[#8b5cf6]/15 group-hover:bg-[#ff3b4d]/10 transition-colors"
											>
												<Loader2 size={14} className="text-[#8b5cf6] animate-spin group-hover:hidden" />
												<Square size={12} className="hidden group-hover:block text-[#ff3b4d] fill-current" />
											</button>
										) : (
											<div className="size-6 flex items-center justify-center shrink-0">
												{status === "completed" && <CheckCircle2 size={14} className="text-[#22c55e]" />}
												{status === "failed" && <Circle size={14} className="text-[#ff3b4d]" />}
												{status === "stopped" && <Circle size={14} className="text-[#eab308]" />}
											</div>
										)}
										{idx < sessions.length - 1 && (
											<div
												className={classNames(
													"w-0.5 flex-1 min-h-[12px] rounded-full mt-0.5 mb-0.5",
													status === "completed" ? "bg-[#22c55e]/40" : "bg-whip-border",
												)}
											/>
										)}
									</div>
									<button
										onClick={() => onSelectSession(session.streamId)}
										className="flex flex-col gap-0.5 pl-2 py-0.5 pb-3 flex-1 min-w-0 text-left cursor-pointer"
									>
										<span
											className={classNames(
												"text-xs",
												isFocused
													? "text-[#c4b5fd]"
													: status === "running"
														? "font-semibold text-whip-text"
														: status === "completed"
															? "text-whip-text"
															: "text-whip-faint",
											)}
										>
											{slotName}
										</span>
										<span className="text-[10px] flex items-center gap-1.5">
											{status === "running" && <span className="text-whip-text">Running</span>}
											{status === "completed" && <span className="text-[#22c55e]">Completed</span>}
											{status !== "running" && status !== "completed" && <span className="text-whip-faint">—</span>}
											{duration && (
												<>
													<span className="text-whip-faint">·</span>
													<span className="text-whip-faint font-mono">{duration}</span>
												</>
											)}
										</span>
									</button>
								</div>
							);
						})
					) : (
						<p className="text-xs text-whip-faint pb-2">Not started yet</p>
					)}
				</div>
			)}
		</div>
	);
}
