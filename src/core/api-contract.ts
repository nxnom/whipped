import { z } from "zod";

// ─── Agent ───────────────────────────────────────────────────────────────────

export const runtimeAgentIdSchema = z.enum(["claude", "codex"]);
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

export const AGENT_BINARY_OPTIONS: ReadonlyArray<{ value: RuntimeAgentId; label: string }> = [
	{ value: "claude", label: "claude" },
	{ value: "codex", label: "codex" },
];

// ─── Workflows ───────────────────────────────────────────────────────────────

export const workflowSlotTypeSchema = z.enum(["dev", "code_review", "qa", "custom"]);
export type WorkflowSlotType = z.infer<typeof workflowSlotTypeSchema>;

export const workflowSlotSchema = z.object({
	id: z.string(),
	type: workflowSlotTypeSchema,
	name: z.string(),
	agentBinary: runtimeAgentIdSchema,
	order: z.number().int().nonnegative(),
	enabled: z.boolean(),
	prompt: z.string().default(""),
});
export type WorkflowSlot = z.infer<typeof workflowSlotSchema>;

export const workflowSchema = z.object({
	id: z.string(),
	name: z.string(),
	isDefault: z.boolean().default(false),
	slots: z.array(workflowSlotSchema),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const DEFAULT_WORKFLOW: Workflow = {
	id: "wf_default",
	name: "Default",
	isDefault: true,
	slots: [
		{ id: "dev", type: "dev", name: "Dev", agentBinary: "claude", order: 0, enabled: true, prompt: "" },
		{ id: "code_review", type: "code_review", name: "Code Review", agentBinary: "claude", order: 1, enabled: true, prompt: "" },
		{ id: "qa", type: "qa", name: "QA", agentBinary: "claude", order: 2, enabled: false, prompt: "" },
	],
};

// ─── Columns ─────────────────────────────────────────────────────────────────

export const runtimeBoardColumnIdSchema = z.enum([
	"todo",
	"ready_for_dev",
	"in_progress",
	"in_review",
	"reopened",
	"ready_for_review",
	"blocked",
	"done",
]);
export type RuntimeBoardColumnId = z.infer<typeof runtimeBoardColumnIdSchema>;

export const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "todo", title: "Todo" },
	{ id: "ready_for_dev", title: "Ready for Dev" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "in_review", title: "In Review" },
	{ id: "reopened", title: "Reopened" },
	{ id: "ready_for_review", title: "Ready for Review" },
	{ id: "blocked", title: "Blocked" },
	{ id: "done", title: "Done" },
];

// ─── Review ───────────────────────────────────────────────────────────────────

export const runtimeReviewCommentSchema = z.object({
	type: z.string(),
	agent: z.string(),
	content: z.string(),
	passed: z.boolean().optional(),
	createdAt: z.number(),
});
export type RuntimeReviewComment = z.infer<typeof runtimeReviewCommentSchema>;

// ─── Activity log ─────────────────────────────────────────────────────────────

export const runtimeActivityEntrySchema = z.object({
	timestamp: z.number(),
	message: z.string(),
});
export type RuntimeActivityEntry = z.infer<typeof runtimeActivityEntrySchema>;

// ─── Terminal sessions ────────────────────────────────────────────────────────

export const runtimeTerminalSessionEntrySchema = z.object({
	streamId: z.string(),
	type: z.string(),
	startedAt: z.number(),
});
export type RuntimeTerminalSessionEntry = z.infer<typeof runtimeTerminalSessionEntrySchema>;

// ─── Priority ─────────────────────────────────────────────────────────────────

export const runtimeCardPrioritySchema = z.enum(["urgent", "high", "medium", "low"]);
export type RuntimeCardPriority = z.infer<typeof runtimeCardPrioritySchema>;

// ─── Card ─────────────────────────────────────────────────────────────────────

export const runtimeBoardCardSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	columnId: runtimeBoardColumnIdSchema,
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	dependsOn: z.array(z.string()).default([]),
	autoFixAttempts: z.number().int().nonnegative().default(0),
	baseRef: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	githubIssueUrl: z.string().optional(),
	githubPrUrl: z.string().optional(),
	jiraKey: z.string().optional(),
	jiraUrl: z.string().optional(),
	workflowId: z.string().optional(),
	reviewComments: z.array(runtimeReviewCommentSchema).default([]),
	activityLog: z.array(runtimeActivityEntrySchema).default([]),
	terminalSessions: z.array(runtimeTerminalSessionEntrySchema).default([]),
	githubCommentIds: z.array(z.string()).default([]),
});
export type RuntimeBoardCard = z.infer<typeof runtimeBoardCardSchema>;

// ─── Column ───────────────────────────────────────────────────────────────────

export const runtimeBoardColumnSchema = z.object({
	id: runtimeBoardColumnIdSchema,
	title: z.string(),
	taskIds: z.array(z.string()),
});
export type RuntimeBoardColumn = z.infer<typeof runtimeBoardColumnSchema>;

// ─── Board ────────────────────────────────────────────────────────────────────

export const runtimeBoardDataSchema = z.object({
	columns: z.array(runtimeBoardColumnSchema),
	cards: z.record(z.string(), runtimeBoardCardSchema),
});
export type RuntimeBoardData = z.infer<typeof runtimeBoardDataSchema>;

// ─── Session ──────────────────────────────────────────────────────────────────

export const runtimeTaskSessionStateSchema = z.enum([
	"idle",
	"running",
	"awaiting_review",
	"review_in_progress",
	"failed",
	"completed",
]);
export type RuntimeTaskSessionState = z.infer<typeof runtimeTaskSessionStateSchema>;

export const runtimeTaskSessionSummarySchema = z.object({
	taskId: z.string(),
	state: runtimeTaskSessionStateSchema,
	agentId: runtimeAgentIdSchema,
	worktreePath: z.string().optional(),
	startedAt: z.number(),
	completedAt: z.number().optional(),
	exitCode: z.number().optional(),
	lastOutput: z.string().optional(),
});
export type RuntimeTaskSessionSummary = z.infer<typeof runtimeTaskSessionSummarySchema>;

// ─── Global config (shared defaults across all projects) ──────────────────────

export const runtimeGlobalConfigSchema = z.object({
	defaultAgent: runtimeAgentIdSchema.default("claude"),
	maxParallelTasks: z.number().int().positive().default(4),
	maxParallelQA: z.number().int().positive().default(1),
	maxAutoFixAttempts: z.number().int().nonnegative().default(3),
	pollingIntervalSeconds: z.number().int().positive().default(30),
	prPollingIntervalSeconds: z.number().int().positive().default(60),
});
export type RuntimeGlobalConfig = z.infer<typeof runtimeGlobalConfigSchema>;

// ─── Per-project config ───────────────────────────────────────────────────────

export const runtimeJiraConfigSchema = z.object({
	host: z.string(),
	email: z.string(),
	token: z.string(),
	projectKey: z.string(),
});
export type RuntimeJiraConfig = z.infer<typeof runtimeJiraConfigSchema>;

export const runtimeGithubConfigSchema = z.object({
	token: z.string(),
});
export type RuntimeGithubConfig = z.infer<typeof runtimeGithubConfigSchema>;

export const runtimeWorktreeSetupSchema = z.object({
	filesToCopy: z.array(z.string()).default([]),
	installCommand: z.string().default(""),
});
export type RuntimeWorktreeSetup = z.infer<typeof runtimeWorktreeSetupSchema>;

export const runtimeProjectConfigSchema = z.object({
	name: z.string().optional(),
	defaultAgent: runtimeAgentIdSchema.optional(),
	maxParallelTasks: z.number().int().positive().optional(),
	autonomousModeEnabled: z.boolean().default(false),
	autoPR: z.boolean().default(false),
	github: runtimeGithubConfigSchema.optional(),
	jira: runtimeJiraConfigSchema.optional(),
	worktreeSetup: runtimeWorktreeSetupSchema.optional(),
	workflows: z.array(workflowSchema).default([DEFAULT_WORKFLOW]),
});
export type RuntimeProjectConfig = z.infer<typeof runtimeProjectConfigSchema>;

// ─── Workspace state ─────────────────────────────────────────────────────────

export const runtimeWorkspaceStateResponseSchema = z.object({
	workspaceId: z.string(),
	repoPath: z.string(),
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema),
	revision: z.number(),
	autonomousModeEnabled: z.boolean(),
	projectConfig: runtimeProjectConfigSchema,
});
export type RuntimeWorkspaceStateResponse = z.infer<typeof runtimeWorkspaceStateResponseSchema>;

export const runtimeWorkspaceStateSaveRequestSchema = z.object({
	board: runtimeBoardDataSchema,
	revision: z.number(),
});
export type RuntimeWorkspaceStateSaveRequest = z.infer<typeof runtimeWorkspaceStateSaveRequestSchema>;

// ─── Card mutations ──────────────────────────────────────────────────────────

export const runtimeCardCreateRequestSchema = z.object({
	title: z.string().min(1),
	description: z.string(),
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	dependsOn: z.array(z.string()).optional(),
	columnId: runtimeBoardColumnIdSchema.optional(),
	baseRef: z.string().optional(),
	githubIssueUrl: z.string().optional(),
	jiraKey: z.string().optional(),
	jiraUrl: z.string().optional(),
	workflowId: z.string().optional(),
});
export type RuntimeCardCreateRequest = z.infer<typeof runtimeCardCreateRequestSchema>;

export const runtimeCardMoveRequestSchema = z.object({
	cardId: z.string(),
	targetColumnId: runtimeBoardColumnIdSchema,
	targetIndex: z.number().int().nonnegative().optional(),
	revision: z.number(),
});
export type RuntimeCardMoveRequest = z.infer<typeof runtimeCardMoveRequestSchema>;

export const runtimeCardUpdateRequestSchema = z.object({
	cardId: z.string(),
	title: z.string().min(1).optional(),
	description: z.string().optional(),
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	dependsOn: z.array(z.string()).optional(),
	revision: z.number(),
});
export type RuntimeCardUpdateRequest = z.infer<typeof runtimeCardUpdateRequestSchema>;

// ─── Jira import ─────────────────────────────────────────────────────────────

export const runtimeJiraTicketSchema = z.object({
	key: z.string(),
	summary: z.string(),
	description: z.string(),
	url: z.string(),
	status: z.string(),
	comments: z.array(z.object({ author: z.string(), body: z.string() })),
});
export type RuntimeJiraTicket = z.infer<typeof runtimeJiraTicketSchema>;

export const runtimeJiraImportRequestSchema = z.object({
	ticketKeys: z.array(z.string()),
	workspaceId: z.string(),
});
export type RuntimeJiraImportRequest = z.infer<typeof runtimeJiraImportRequestSchema>;

// ─── WebSocket events ─────────────────────────────────────────────────────────

export type RuntimeStateEvent =
	| { type: "snapshot"; state: RuntimeWorkspaceStateResponse }
	| { type: "workspace_updated"; state: RuntimeWorkspaceStateResponse }
	| { type: "session_updated"; taskId: string; session: RuntimeTaskSessionSummary }
	| { type: "terminal_output"; taskId: string; data: string }
	| { type: "autonomous_mode_changed"; enabled: boolean };

// ─── Project ──────────────────────────────────────────────────────────────────

export const runtimeProjectSchema = z.object({
	workspaceId: z.string(),
	repoPath: z.string(),
	name: z.string(),
	lastUpdated: z.number(),
});
export type RuntimeProject = z.infer<typeof runtimeProjectSchema>;
