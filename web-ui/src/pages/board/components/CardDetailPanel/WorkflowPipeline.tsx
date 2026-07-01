import { Tooltip } from "@geckoui/geckoui";
import type { RuntimeBoardCard, WorkflowSlot } from "@runtime-contract";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Square } from "lucide-react";
import { classNames } from "@/utils/classNames";
import { SESSION_TYPE_LABELS, slotDuration } from "./constants";

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

function sessionStatus(session: TerminalSession): "running" | "failed" | "stopped" | "completed" {
	if (!session.endedAt) return "running";
	if (session.state === "failed" || session.state === "stopped") return session.state;
	return "completed";
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
			<div
				className={classNames("pt-3.5 pb-2 flex items-center", sidebarCollapsed ? "justify-center px-0" : "px-[18px]")}
			>
				{!sidebarCollapsed && (
					<span className="text-[11px] font-semibold text-[#8a8f98] tracking-[0.3px] flex-1">Workflow Pipeline</span>
				)}
				<button
					onClick={onToggleCollapsed}
					className="text-[#5f6672] hover:text-[#8a8f98] transition-colors"
					title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
				>
					{sidebarCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
				</button>
			</div>
			{sidebarCollapsed ? (
				/* Collapsed: icon-only timeline centered */
				<div className="flex flex-col items-center pb-4 gap-0">
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
												"size-7 rounded-full flex items-center justify-center cursor-pointer transition-colors",
												status === "running"
													? "bg-[#8b5cf6]/15 group-hover:bg-[#ff3b4d]/10"
													: isFocused
														? "bg-[#8b5cf6]/15"
														: "hover:bg-white/[0.05]",
											)}
										>
											{status === "completed" && <CheckCircle2 size={14} className="text-[#22c55e]" />}
											{status === "running" && <Loader2 size={14} className="text-[#8b5cf6] animate-spin" />}
											{status === "failed" && <Circle size={14} className="text-[#ff3b4d]" />}
											{status === "stopped" && <Circle size={14} className="text-[#eab308]" />}
										</button>
									</Tooltip>
									{idx < sessions.length - 1 && (
										<div
											className={classNames(
												"w-0.5 h-4 rounded-full",
												status === "completed" ? "bg-[#22c55e]/40" : "bg-[#2a2a2a]",
											)}
										/>
									)}
								</div>
							);
						})
					) : (
						<div className="size-2 rounded-full bg-[#2a2a2a] mt-1" />
					)}
				</div>
			) : (
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
													status === "completed" ? "bg-[#22c55e]/40" : "bg-[#2a2a2a]",
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
													? "text-[#c4baff]"
													: status === "running"
														? "font-semibold text-[#ededed]"
														: status === "completed"
															? "text-[#ededed]"
															: "text-[#5f6672]",
											)}
										>
											{slotName}
										</span>
										<span className="text-[10px] flex items-center gap-1.5">
											{status === "running" && <span className="text-[#f5f5f5]">Running</span>}
											{status === "completed" && <span className="text-[#22c55e]">Completed</span>}
											{status !== "running" && status !== "completed" && <span className="text-[#5f6672]">—</span>}
											{duration && (
												<>
													<span className="text-[#5f6672]">·</span>
													<span className="text-[#5f6672] font-mono">{duration}</span>
												</>
											)}
										</span>
									</button>
								</div>
							);
						})
					) : (
						<p className="text-xs text-[#5f6672] pb-2">Not started yet</p>
					)}
				</div>
			)}
		</div>
	);
}
