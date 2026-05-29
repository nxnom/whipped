import type { Env } from "hono";
import type { RunSessionStatus } from "../../core/api-contract.js";
import type { BoardPoller } from "../../daemon/poller.js";
import type { TaskScheduler } from "../../daemon/scheduler.js";
import type { RuntimeStateHub } from "../../server/runtime-state-hub.js";

export interface RunSession {
	cardId: string | null;
	status: RunSessionStatus;
	errorMessage?: string;
	outputBuffer: string;
	kill: () => void;
	writeInput: (data: string) => void;
}

export interface AppContext {
	stateHub: RuntimeStateHub;
	getScheduler: (workspaceId: string) => TaskScheduler | undefined;
	getPoller: (workspaceId: string) => BoardPoller | undefined;
	ensureWorkspace: (workspaceId: string) => Promise<{ workspaceId: string; repoPath: string }>;
	currentWorkspaceId: string | null;
	currentRepoPath: string | null;
	startRun: (workspaceId: string, cardId: string | null, command: string, cwd: string) => void;
	stopRun: (workspaceId: string) => void;
	getRunSession: (workspaceId: string) => RunSession | null;
}

export interface AppEnv extends Env {
	Variables: {
		ctx: AppContext;
	};
}
