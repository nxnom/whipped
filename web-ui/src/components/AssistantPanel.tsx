import { Button, Select, SelectOption } from "@geckoui/geckoui";
import { type AgentModelChoice, DEFAULT_AGENT_MODEL_CHOICE } from "@runtime-contract";
import { Bot, ClipboardList, FileText, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentModelPicker } from "@/components/AgentModelPicker";
import { AssistantPlanDialog } from "@/components/AssistantPlanDialog";
import { usePlanVersions } from "@/components/plan/usePlanVersions";
import { useSavedPlans } from "@/components/plan/useSavedPlans";
import { TaskTerminal } from "@/components/terminal/TaskTerminal";
import { useRead, useWrite } from "@/runtime/api-client";
import { useWorkspaceState } from "@/stores/board-store";
import { classNames } from "@/utils/classNames";

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 520;

interface Props {
	workspaceId: string;
	open: boolean;
	onClose: () => void;
}

export function AssistantPanel({ workspaceId, open, onClose }: Props) {
	const [taskId, setTaskId] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [starting, setStarting] = useState(false);
	const startingRef = useRef(false);
	const [pickedModel, setPickedModel] = useState<AgentModelChoice | null>(null);
	const [savedPlanId, setSavedPlanId] = useState("");
	const [planDialogOpen, setPlanDialogOpen] = useState(false);
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

	const { state: wsState } = useWorkspaceState(workspaceId);
	const defaultModel = wsState?.projectConfig?.assistantModel ?? DEFAULT_AGENT_MODEL_CHOICE;
	const modelValue = pickedModel ?? defaultModel;

	const { trigger: fetchSessionStatus } = useRead((api) => api("agent/session").GET({ query: { workspaceId } }), {
		enabled: false,
	});
	const { trigger: startSessionRequest } = useWrite((api) => api("agent/session").POST());
	const { trigger: stopSessionRequest } = useWrite((api) => api("agent/session").DELETE());
	const { plans, sendFeedback } = usePlanVersions(workspaceId, taskId ?? "");
	const { list: savedPlansList, remove: removeSavedPlan } = useSavedPlans(workspaceId);
	const savedPlans = savedPlansList.data?.plans ?? [];

	const onDeleteSavedPlan = async (id: string) => {
		await removeSavedPlan.trigger({ params: { id } });
		if (savedPlanId === id) setSavedPlanId("");
		void savedPlansList.trigger();
	};

	// A new plan version arriving is worth surfacing even if the developer
	// closed a previous one — this only depends on the latest version number,
	// so it doesn't reopen the dialog on every unrelated re-render.
	useEffect(() => {
		if (plans[0]?.version === undefined) return;
		setPlanDialogOpen(true);
	}, [plans[0]?.version]);

	const onDragStart = (e: React.MouseEvent) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		const onMove = (ev: MouseEvent) => {
			if (!dragRef.current) return;
			// Dragging left increases width (panel is on the right)
			const delta = dragRef.current.startX - ev.clientX;
			setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta)));
		};
		const onUp = () => {
			dragRef.current = null;
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	// On open, only check whether a session is already running — never auto-start.
	// If one is running we reattach straight to its terminal (no picker, no restart).
	// If not, the empty state below asks the user to pick a model before starting.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setChecking(true);

		const check = async () => {
			try {
				const { data: status } = await fetchSessionStatus();
				if (cancelled) return;
				setTaskId(status?.running && status.taskId ? status.taskId : null);
			} catch {
				if (!cancelled) setTaskId(null);
			} finally {
				if (!cancelled) setChecking(false);
			}
		};

		void check();
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	const startSession = async () => {
		if (startingRef.current) return;
		startingRef.current = true;
		setStarting(true);
		try {
			const { data: result } = await startSessionRequest({
				body: { workspaceId, override: modelValue, savedPlanId: savedPlanId || undefined },
			});
			setTaskId(result?.taskId ?? null);
		} finally {
			startingRef.current = false;
			setStarting(false);
		}
	};

	const stopSession = async () => {
		await stopSessionRequest({ query: { workspaceId } }).catch(() => {});
		setTaskId(null);
		onClose();
	};

	const handleClose = () => onClose();

	return (
		<div className={classNames("shrink-0 flex overflow-hidden", !open && "hidden")} style={{ width }}>
			{/* Drag handle */}
			<div
				onMouseDown={onDragStart}
				className="w-1 shrink-0 cursor-col-resize hover:bg-[#7c6aff]/40 active:bg-[#7c6aff]/60 transition-colors bg-[#2a2a35]"
			/>
			<div className="flex-1 border-l border-[#2a2a35] flex flex-col overflow-hidden">
				<div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a35] shrink-0">
					<div className="flex items-center gap-2">
						<Bot size={16} className="text-[#7c6aff]" />
						<h2 className="text-sm font-medium text-[#f0f0f5]">Assistant</h2>
					</div>
					<div className="flex items-center gap-2">
						{plans.length > 0 && (
							<Button variant="ghost" size="sm" onClick={() => setPlanDialogOpen(true)}>
								<ClipboardList size={13} />
							</Button>
						)}
						{taskId && (
							<Button variant="ghost" size="sm" onClick={() => void stopSession()}>
								<Square size={13} className="mr-1" /> Stop
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={handleClose}>
							<X size={14} />
						</Button>
					</div>
				</div>

				<div className="flex-1 min-h-0 flex flex-col">
					{checking ? null : taskId ? (
						<TaskTerminal taskId={taskId} workspaceId={workspaceId} className="flex-1 min-h-0" />
					) : (
						<div className="flex-1 flex flex-col items-center justify-center gap-4 text-[#60607a] px-6">
							<Bot size={40} />
							<p className="text-sm text-center">
								Pick a model to start an interactive session for managing your board
							</p>
							<div className="w-full max-w-sm flex flex-col gap-2">
								<AgentModelPicker value={modelValue} onChange={setPickedModel} />
								{savedPlans.length > 0 && (
									<Select
										value={savedPlanId}
										onChange={(v) => setSavedPlanId(v as string)}
										placeholder="Start from saved plan (optional)"
										prefix={<FileText size={13} className="text-[#8888a0]" />}
									>
										<SelectOption value="" label="None — start fresh" />
										{savedPlans.map((p) => (
											<SelectOption key={p.id} value={p.id} label={p.title} onRemove={() => onDeleteSavedPlan(p.id)} />
										))}
									</Select>
								)}
							</div>
							<Button size="sm" onClick={() => void startSession()} disabled={starting}>
								{starting ? "Starting..." : "Start Session"}
							</Button>
						</div>
					)}
				</div>
			</div>
			{taskId && (
				<AssistantPlanDialog
					sessionId={taskId}
					plans={plans}
					sendFeedback={sendFeedback}
					open={planDialogOpen}
					onClose={() => setPlanDialogOpen(false)}
				/>
			)}
		</div>
	);
}
