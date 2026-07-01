import type { AgentModelChoice } from "../../core/api-contract.js";
import type { TaskScheduler } from "../../daemon/scheduler.js";

export const startAgentSession = async (scheduler: TaskScheduler, override?: AgentModelChoice) => ({
	taskId: await scheduler.startAssistantAgent(override),
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
