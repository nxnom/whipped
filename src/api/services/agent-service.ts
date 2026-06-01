import type { TaskScheduler } from "../../daemon/scheduler.js";

export const startAgentSession = async (scheduler: TaskScheduler) => ({
	taskId: await scheduler.startAssistantAgent(),
});

export const stopAgentSession = async (scheduler: TaskScheduler | undefined) => {
	scheduler?.stopAssistantAgent();
};

export const getAgentSessionStatus = async (scheduler: TaskScheduler | undefined) => {
	if (!scheduler) return { running: false, taskId: null };
	return {
		running: scheduler.isAssistantAgentRunning(),
		taskId: scheduler.assistantAgentTaskId,
	};
};
