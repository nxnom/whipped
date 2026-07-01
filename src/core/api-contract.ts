import { z } from "zod";

// The assistant agent isn't tied to a card: its task id is a synthetic
// `<prefix><workspaceId>`, never a row in `cards`. Used to keep it out of
// card-id foreign keys (e.g. memories.origin_card_id).
export const ASSISTANT_AGENT_PREFIX = "__assistant__:";

// ─── Agent ───────────────────────────────────────────────────────────────────

export const runtimeAgentIdSchema = z.enum(["claude", "codex", "opencode", "cursor", "mimo"]);
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

export const AGENT_BINARY_OPTIONS: ReadonlyArray<{ value: RuntimeAgentId; label: string }> = [
	{ value: "claude", label: "claude" },
	{ value: "codex", label: "codex" },
	{ value: "opencode", label: "opencode" },
	{ value: "cursor", label: "cursor" },
	{ value: "mimo", label: "mimo" },
];

export const effortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof effortLevelSchema>;

export const EFFORT_OPTIONS: ReadonlyArray<{ value: EffortLevel; label: string }> = [
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "Extra High" },
	{ value: "max", label: "Max" },
];

// Curated model presets per agent. Empty value = agent default. Users may also
// type a custom model string (e.g. a dated release name) via the "Custom" option.
// Claude options use the full model ID as the value so version is pinned;
// the aliases ("opus"/"sonnet"/"haiku") also work but drift over time.
export const MODEL_OPTIONS: Record<RuntimeAgentId, ReadonlyArray<{ value: string; label: string }>> = {
	claude: [
		{ value: "claude-opus-4-8", label: "Opus 4.8" },
		{ value: "claude-opus-4-7", label: "Opus 4.7" },
		{ value: "claude-opus-4-6", label: "Opus 4.6" },
		{ value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
		{ value: "claude-sonnet-4-5", label: "Sonnet 4.5" },
		{ value: "claude-haiku-4-5", label: "Haiku 4.5" },
	],
	codex: [
		{ value: "gpt-5.5", label: "GPT-5.5 (default)" },
		{ value: "gpt-5.4", label: "GPT-5.4" },
		{ value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
		{ value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
		{ value: "gpt-5.2", label: "GPT-5.2" },
	],
	// opencode supports any provider/model string — no fixed presets.
	// The UI renders a free-form text input for opencode model selection.
	opencode: [],
	// cursor supports many models — no fixed presets.
	// The UI fetches the live list via agents.cursorModels and renders a Select.
	cursor: [],
	// mimo (mimocode) lists models as provider/model strings, like opencode —
	// no fixed presets; the UI fetches the live list and renders a Select.
	mimo: [],
};

// A fixed agent binary + model + effort pick. Used by the assistant agent and
// recurring agents — a single configured model, no level/tier resolution.
export const agentModelChoiceSchema = z.object({
	agentId: runtimeAgentIdSchema.default("claude"),
	model: z.string().nullable().optional(),
	effort: effortLevelSchema.nullable().optional(),
});
export type AgentModelChoice = z.infer<typeof agentModelChoiceSchema>;

export const DEFAULT_AGENT_MODEL_CHOICE: AgentModelChoice = { agentId: "claude", model: null, effort: null };

// ─── Workflows ───────────────────────────────────────────────────────────────

// dev     — implements the task (the only slot with write access to the worktree).
// review  — one-shot reviewer; replaces the old code_review/qa/custom slots. Tools
//           (e.g. browser) are granted per slot, and several review slots can be
//           chained (dev → review1 → reviewN) via `order`.
// plan    — one-shot planner; runs once before dev and saves a plan onto the card.
// orch    — story-only orchestrator over subtasks.
export const workflowSlotTypeSchema = z.enum(["dev", "review", "plan", "orch"]);
export type WorkflowSlotType = z.infer<typeof workflowSlotTypeSchema>;

// ─── Model tiers ───────────────────────────────────────────────────────────────
// A slot carries a list of model "pairs", each tagged with a capability level and
// a free/paid flag. The card has one workflow-wide active level; every slot
// resolves that level to its own pair (see resolvePair). The review agent may set
// the active level on reopen (canAdjustLevel) — e.g. a trivial change → "minimal".
export const tierLevelSchema = z.enum(["minimal", "low", "medium", "high", "max"]);
export type TierLevel = z.infer<typeof tierLevelSchema>;

// Ordered cheapest/least-capable → smartest. Used for nearest-level fallback.
export const LEVEL_ORDER = ["minimal", "low", "medium", "high", "max"] as const;

export const TIER_LEVEL_OPTIONS: ReadonlyArray<{ value: TierLevel; label: string }> = [
	{ value: "minimal", label: "Minimal" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "max", label: "Max" },
];

export const modelPairSchema = z.object({
	id: z.string(),
	level: tierLevelSchema,
	isFree: z.boolean().default(false),
	binary: runtimeAgentIdSchema,
	model: z.string().nullable().optional(),
	effort: effortLevelSchema.nullable().optional(),
});
export type ModelPair = z.infer<typeof modelPairSchema>;

// How a slot picks among the pairs at the active level (pairs are ordered, top =
// highest priority):
//   auto       — top pair, any cost
//   preferFree — top free pair, else top paid
//   freeOnly   — top free pair (search lower levels for one; else top as fallback)
//   paidOnly   — top paid pair (same fallback)
export const pairSelectionModeSchema = z.enum(["auto", "preferFree", "freeOnly", "paidOnly"]);
export type PairSelectionMode = z.infer<typeof pairSelectionModeSchema>;

export const PAIR_SELECTION_MODE_OPTIONS: ReadonlyArray<{ value: PairSelectionMode; label: string }> = [
	{ value: "auto", label: "Auto (priority)" },
	{ value: "preferFree", label: "Prefer free" },
	{ value: "freeOnly", label: "Free only" },
	{ value: "paidOnly", label: "Paid only" },
];

// Tools a slot may reach for. Granted per slot (not per agent type). Extend by
// adding an id here and registering the matching MCP server in the review pipeline.
export const SLOT_TOOL_IDS = ["browser"] as const;
export const slotToolSchema = z.enum(SLOT_TOOL_IDS);
export type SlotTool = z.infer<typeof slotToolSchema>;

export const SLOT_TOOL_OPTIONS: ReadonlyArray<{ value: SlotTool; label: string }> = [
	{ value: "browser", label: "Browser control" },
];

// The per-slot model config that is snapshotted onto a card at creation, so each
// ticket can tune cost independently of the workflow template.
//   mode         — the selection policy (snapshotted from the workflow slot).
//   pinnedPairId — per-ticket hard override: run exactly this pair, ignoring
//                  mode/level. Absent = follow mode.
export const slotModelConfigSchema = z.object({
	pairs: z.array(modelPairSchema).min(1),
	mode: pairSelectionModeSchema.default("auto"),
	pinnedPairId: z.string().optional(),
});
export type SlotModelConfig = z.infer<typeof slotModelConfigSchema>;

// Card-level snapshot: slotId → its model config.
export const cardModelConfigSchema = z.record(z.string(), slotModelConfigSchema);
export type CardModelConfig = z.infer<typeof cardModelConfigSchema>;

// Pick the candidate at a given level for a mode. Returns undefined when the mode
// can't be satisfied at that level (free/paid-only with no match) so the caller
// can search other levels.
function pickByMode(candidates: ModelPair[], mode: PairSelectionMode): ModelPair | undefined {
	switch (mode) {
		case "preferFree":
			return candidates.find((p) => p.isFree) ?? candidates[0];
		case "freeOnly":
			return candidates.find((p) => p.isFree);
		case "paidOnly":
			return candidates.find((p) => !p.isFree);
		default:
			return candidates[0];
	}
}

// Resolve which pair a slot runs for the card's active level. A per-ticket pin
// wins outright. Otherwise capability (level) leads: at the active level — pairs
// kept in priority order — the mode chooses one. If the exact level has no match,
// search upward first (a more capable tier is the safer fallback) and only then
// downward, so a slot always resolves to something.
export function resolvePair(cfg: SlotModelConfig, activeLevel: TierLevel): ModelPair {
	if (cfg.pinnedPairId) {
		const pinned = cfg.pairs.find((p) => p.id === cfg.pinnedPairId);
		if (pinned) return pinned;
	}
	const startIdx = LEVEL_ORDER.indexOf(activeLevel);
	// Scan order: the active level, then upward (more capable = safer), then downward.
	const order: number[] = [];
	for (let i = startIdx; i < LEVEL_ORDER.length; i++) order.push(i);
	for (let i = startIdx - 1; i >= 0; i--) order.push(i);

	for (const i of order) {
		const candidates = cfg.pairs.filter((p) => p.level === LEVEL_ORDER[i]);
		if (candidates.length === 0) continue;
		const pick = pickByMode(candidates, cfg.mode);
		if (pick) return pick;
	}
	// Mode unsatisfiable anywhere (e.g. freeOnly with no free pair) → nearest top pair.
	for (const i of order) {
		const candidates = cfg.pairs.filter((p) => p.level === LEVEL_ORDER[i]);
		if (candidates[0]) return candidates[0];
	}
	const fallback = cfg.pairs[0];
	if (!fallback) throw new Error("resolvePair: slot has no model pairs");
	return fallback;
}

// Prompt value: either inline text or a path to a file (relative to repo root,
// or absolute). The zod preprocess accepts a bare string for legacy data and
// normalises it to the inline shape, so old workflow rows transparently
// upgrade on first read.
export const promptValueSchema = z.preprocess(
	(v) => {
		if (typeof v === "string") return { source: "inline", text: v };
		return v;
	},
	z.discriminatedUnion("source", [
		z.object({ source: z.literal("inline"), text: z.string() }),
		z.object({ source: z.literal("file"), path: z.string() }),
	]),
);
export type PromptValue = z.infer<typeof promptValueSchema>;

export const EMPTY_INLINE_PROMPT: PromptValue = { source: "inline", text: "" };

export const workflowSlotSchema = z.object({
	id: z.string(),
	type: workflowSlotTypeSchema,
	name: z.string(),
	order: z.number().int().nonnegative(),
	enabled: z.boolean(),
	prompt: promptValueSchema.default(EMPTY_INLINE_PROMPT),
	// Model tiers for this slot, in priority order (top = highest). Copied to the
	// card at creation; the card's active level + mode select which pair runs.
	pairs: z.array(modelPairSchema).min(1),
	mode: pairSelectionModeSchema.default("auto"),
	// Tools this slot may use (e.g. "browser"). Workflow-only, not ticket-editable.
	tools: z.array(slotToolSchema).default([]),
	// review slots only: may set the card's active level on reopen.
	canAdjustLevel: z.boolean().default(false),
	// plan slots only: re-run even if a plan already exists on the card.
	rerun: z.boolean().default(false),
});
export type WorkflowSlot = z.infer<typeof workflowSlotSchema>;

// Starter pair used when scaffolding default workflows.
export const DEFAULT_MODEL_PAIR: ModelPair = {
	id: "default",
	level: "medium",
	isFree: false,
	binary: "claude",
	model: null,
	effort: null,
};

const DEFAULT_SLOT_MODEL_FIELDS: Pick<WorkflowSlot, "pairs" | "mode"> = {
	pairs: [DEFAULT_MODEL_PAIR],
	mode: "auto",
};

export const workflowSchema = z.object({
	id: z.string(),
	name: z.string(),
	isDefault: z.boolean().default(false),
	forStory: z.boolean().default(false),
	slots: z.array(workflowSlotSchema),
});
export type Workflow = z.infer<typeof workflowSchema>;

export const DEFAULT_WORKFLOW: Workflow = {
	id: "wf_default",
	name: "Default",
	isDefault: true,
	forStory: false,
	slots: [
		{
			id: "plan",
			type: "plan",
			name: "Plan",
			order: 0,
			enabled: false,
			prompt: EMPTY_INLINE_PROMPT,
			...DEFAULT_SLOT_MODEL_FIELDS,
			tools: [],
			canAdjustLevel: false,
			rerun: false,
		},
		{
			id: "dev",
			type: "dev",
			name: "Dev",
			order: 1,
			enabled: true,
			prompt: EMPTY_INLINE_PROMPT,
			...DEFAULT_SLOT_MODEL_FIELDS,
			tools: [],
			canAdjustLevel: false,
			rerun: false,
		},
		{
			id: "code_review",
			type: "review",
			name: "Code Review",
			order: 2,
			enabled: true,
			prompt: EMPTY_INLINE_PROMPT,
			...DEFAULT_SLOT_MODEL_FIELDS,
			tools: [],
			canAdjustLevel: false,
			rerun: false,
		},
		{
			id: "qa",
			type: "review",
			name: "QA",
			order: 3,
			enabled: false,
			prompt: EMPTY_INLINE_PROMPT,
			...DEFAULT_SLOT_MODEL_FIELDS,
			tools: ["browser"],
			canAdjustLevel: false,
			rerun: false,
		},
	],
};

export const DEFAULT_STORY_WORKFLOW: Workflow = {
	id: "wf_story_default",
	name: "Story Default",
	isDefault: true,
	forStory: true,
	slots: [
		{
			id: "orch",
			type: "orch",
			name: "Orchestrator",
			order: 0,
			enabled: true,
			prompt: EMPTY_INLINE_PROMPT,
			...DEFAULT_SLOT_MODEL_FIELDS,
			tools: [],
			canAdjustLevel: false,
			rerun: false,
		},
	],
};

// Resolve which workflow applies to a card: explicit workflowId wins, then the
// default workflow matching the card's story-ness, then any matching, then first.
export function resolveWorkflowForCard(
	workflows: Workflow[],
	card: { workflowId?: string; type?: CardType },
): Workflow | undefined {
	const isStory = card.type === "story";
	return (
		workflows.find((w) => w.id === card.workflowId) ??
		workflows.find((w) => w.isDefault && w.forStory === isStory) ??
		workflows.find((w) => w.forStory === isStory) ??
		workflows[0]
	);
}

// Snapshot a workflow's per-slot model config onto a card at creation time.
export function snapshotModelConfig(workflow: Workflow | undefined): CardModelConfig {
	const config: CardModelConfig = {};
	for (const slot of workflow?.slots ?? []) {
		config[slot.id] = { pairs: slot.pairs, mode: slot.mode };
	}
	return config;
}

// The highest tier present across a workflow's pairs — the default active level
// for a new card so the strongest configured models run unless the user lowers it.
export function highestWorkflowLevel(workflow: Workflow | undefined): TierLevel {
	let bestIdx = -1;
	for (const slot of workflow?.slots ?? []) {
		for (const p of slot.pairs) bestIdx = Math.max(bestIdx, LEVEL_ORDER.indexOf(p.level));
	}
	return LEVEL_ORDER[bestIdx] ?? "medium";
}

// ─── Default git instructions ────────────────────────────────────────────────
// Used when a project doesn't override `gitInstructions` in its config.
// Also pre-filled as starter text in the UI when the field is empty.
export const DEFAULT_GIT_INSTRUCTIONS = `# Git conventions

These rules govern how to write commit messages, PR titles, and PR
descriptions.

## PR title
- Imperative, present tense: "Add board view", "Fix race in poller".
  Not past tense, not gerund.
- ≤70 characters; aim for 50.
- Describe what shipped, not the task. "Add board view" beats
  "Implement board view feature".
- No prefixes like \`feat:\` / \`[FEAT]\` / \`fix:\`.
- No ticket IDs in the title (put them in the description if needed).
- No trailing period.

## PR description
Keep it focused. Two sections, nothing more unless genuinely useful:

    ## Summary
    - What changed and why. Use as many bullets as the scope warrants —
      a one-line fix is one bullet; a refactor touching 20 files may
      need ten. Don't pad, don't truncate.

    ## Test plan
    - What you actually ran or clicked, and the outcome.
    - Type-check and lint passing are not a test plan on their own.
    - If something couldn't be verified, say so in one line.

Do NOT include:
- Iteration narration ("Round N", "addressed feedback", "after review").
- Commit SHAs or branch names — GitHub already shows both.
- Paths to internal planning docs, scratch files, or task tracker URLs.
- "Verification:" sections that only list a passing type-check or lint.
- Self-congratulation ("clean", "all checks pass", "ready to merge").
- Restating the task description verbatim.

## Commit messages
- Short imperative subject line, ≤72 chars. That's usually enough.
- Skip the body unless a reviewer reading the diff alone would be
  confused about *why* the change exists.
- Reference an issue only if a concrete one exists to close
  (\`Closes #123\`). Never invent issue numbers.
`;

// ─── Columns ─────────────────────────────────────────────────────────────────

export const runtimeBoardColumnIdSchema = z.enum([
	"todo",
	"in_progress",
	"reopened",
	"ready_for_review",
	"blocked",
	"done",
]);
export type RuntimeBoardColumnId = z.infer<typeof runtimeBoardColumnIdSchema>;

export const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "todo", title: "Todo" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "reopened", title: "Reopened" },
	{ id: "ready_for_review", title: "Ready for Review" },
	{ id: "blocked", title: "Blocked" },
	{ id: "done", title: "Done" },
];

// ─── Review ───────────────────────────────────────────────────────────────────

export const reviewActorSchema = z.object({
	type: z.enum(["ai", "human", "external"]),
	id: z.string(),
	source: z.string().optional(),
});
export type RuntimeReviewActor = z.infer<typeof reviewActorSchema>;

export const reviewIssueSchema = z.object({
	file: z.string().optional(),
	line: z.number().optional(),
	severity: z.enum(["blocking", "warning", "info"]),
	message: z.string(),
});
export type RuntimeReviewIssue = z.infer<typeof reviewIssueSchema>;

export const reviewAttachmentSchema = z.object({
	type: z.string(), // "image" | "file" | any mime category
	name: z.string(),
	mimeType: z.string(),
	path: z.string(), // absolute path in ~/.whipped/attachments/
});
export type RuntimeReviewAttachment = z.infer<typeof reviewAttachmentSchema>;

export type RuntimeReviewStatus = "pass" | "fail" | "warning" | "skipped";

export const runtimeReviewCommentSchema = z.object({
	id: z.string(),
	type: z.string(),
	actor: reviewActorSchema,
	status: z.enum(["pass", "fail", "warning", "skipped"]).optional(),
	createdAt: z.number(),
	streamId: z.string().optional(),
	summary: z.string(),
	issues: z.array(reviewIssueSchema).optional(),
	attachments: z.array(reviewAttachmentSchema).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RuntimeReviewComment = z.infer<typeof runtimeReviewCommentSchema>;

// ─── Activity log ─────────────────────────────────────────────────────────────

export const runtimeActivityEntrySchema = z.object({
	timestamp: z.number(),
	message: z.string(),
});
export type RuntimeActivityEntry = z.infer<typeof runtimeActivityEntrySchema>;

// ─── Session state ────────────────────────────────────────────────────────────

export const runtimeTaskSessionStateSchema = z.enum(["running", "stopped", "completed", "failed", "killed"]);
export type RuntimeTaskSessionState = z.infer<typeof runtimeTaskSessionStateSchema>;

// A session that was interrupted mid-run — either the server died ("killed") or the
// user pressed stop ("stopped"). Both resume from the last good point on next pickup;
// the resume logic treats them identically.
export function isResumableSessionState(state: RuntimeTaskSessionState | undefined): boolean {
	return state === "killed" || state === "stopped";
}

// ─── Terminal sessions ────────────────────────────────────────────────────────

export const runtimeTerminalSessionEntrySchema = z.object({
	streamId: z.string(),
	type: z.string(),
	startedAt: z.number(),
	endedAt: z.number().optional(),
	agentId: runtimeAgentIdSchema.optional(),
	state: runtimeTaskSessionStateSchema.optional(),
});
export type RuntimeTerminalSessionEntry = z.infer<typeof runtimeTerminalSessionEntrySchema>;

// ─── Priority ─────────────────────────────────────────────────────────────────

export const runtimeCardPrioritySchema = z.enum(["urgent", "high", "medium", "low"]);
export type RuntimeCardPriority = z.infer<typeof runtimeCardPrioritySchema>;

// ─── Card type ────────────────────────────────────────────────────────────────

export const cardTypeSchema = z.enum(["task", "story", "subtask"]);
export type CardType = z.infer<typeof cardTypeSchema>;

// ─── PR metadata (provider-agnostic) ─────────────────────────────────────────

export const runtimePrMetaSchema = z.object({
	url: z.string().optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	updatedAt: z.number().optional(),
	updatedBy: z.string().optional(),
});
export type RuntimePrMeta = z.infer<typeof runtimePrMetaSchema>;

// ─── Card ─────────────────────────────────────────────────────────────────────

export const runtimeBoardCardSchema = z.object({
	id: z.string(),
	description: z.string(),
	descriptionAttachments: z.array(reviewAttachmentSchema).optional().default([]),
	columnId: runtimeBoardColumnIdSchema,
	type: cardTypeSchema.default("task"),
	readyForDev: z.boolean().default(false),
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	// Single-parent stacking: this card continues in the parent's worktree/branch
	// and starts once the parent reaches ready_for_review. Mutually exclusive with waitsFor.
	dependsOn: z.string().optional(),
	// Many-parent gate (tasks only): this card starts only once ALL listed cards are
	// done (merged), in a fresh worktree branched from baseRef. Mutually exclusive with dependsOn.
	waitsFor: z.array(z.string()).default([]),
	// Story-only: the IDs of this story's subtasks. The story triggers its orchestrator
	// workflow once every subtask reaches ready_for_review.
	subtaskIds: z.array(z.string()).default([]),
	autoFixAttempts: z.number().int().nonnegative().default(0),
	baseRef: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	githubIssueUrl: z.string().optional(),
	pr: runtimePrMetaSchema.optional(),
	workflowId: z.string().optional(),
	// Plan written by the one-shot plan agent; injected into the dev agent's prompt.
	plan: z.string().optional(),
	// Workflow-wide capability level; every slot resolves it to its own pair.
	activeLevel: tierLevelSchema.default("medium"),
	// Per-slot model config, snapshotted from the workflow at creation and editable
	// per ticket (slotId → {pairs, mode, pinnedPairId}).
	modelConfig: cardModelConfigSchema.optional(),
	reviewComments: z.array(runtimeReviewCommentSchema).default([]),
	activityLog: z.array(runtimeActivityEntrySchema).default([]),
	terminalSessions: z.array(runtimeTerminalSessionEntrySchema).default([]),
	githubCommentIds: z.array(z.string()).default([]),
	worktreePath: z.string().optional(),
	branchName: z.string().optional(),
	slackMessageTs: z.string().optional(),
	slackChannelId: z.string().optional(),
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

// ─── Notification sounds (played on the daemon host, not the browser) ─────────

export const NOTIFICATION_SOUND_EVENTS = [
	"readyForReview",
	"prComment",
	"done",
	"reopened",
	"blocked",
	"runError",
] as const;
export type NotificationSoundEvent = (typeof NOTIFICATION_SOUND_EVENTS)[number];

// Master `enabled` is off by default so the daemon stays silent until the user
// opts in. Per-event flags default on, so flipping the master switch enables all.
export const notificationSoundsConfigSchema = z.object({
	enabled: z.boolean().default(false),
	readyForReview: z.boolean().default(true),
	prComment: z.boolean().default(true),
	done: z.boolean().default(true),
	reopened: z.boolean().default(true),
	blocked: z.boolean().default(true),
	runError: z.boolean().default(true),
});
export type NotificationSoundsConfig = z.infer<typeof notificationSoundsConfigSchema>;

// ─── Global config (shared defaults across all projects) ──────────────────────

export const runtimeGlobalConfigSchema = z.object({
	defaultAgent: runtimeAgentIdSchema.default("claude"),
	maxParallelTasks: z.number().int().positive().default(4),
	maxParallelQA: z.number().int().positive().default(1),
	maxAutoFixAttempts: z.number().int().nonnegative().default(3),
	pollingIntervalSeconds: z.number().int().positive().default(30),
	prPollingIntervalSeconds: z.number().int().positive().default(60),
	terminalApp: z.string().optional(),
	notificationSounds: notificationSoundsConfigSchema.prefault({}),
	slackEnabled: z.boolean().default(true),
	slackBotToken: z.string().optional(),
	slackSigningSecret: z.string().optional(),
	slackAppConfigToken: z.string().optional(),
	slackClientId: z.string().optional(),
	slackClientSecret: z.string().optional(),
	slackAppId: z.string().optional(),
	slackOauthAuthorizeUrl: z.string().optional(),
	slackPublicUrl: z.string().optional(),
	slackBotName: z.string().default("Whipped"),
	slackInstallerUserId: z.string().optional(),
	autoStartTunnel: z.boolean().default(false),
	tunnelId: z.string().optional(),
	tunnelDomain: z.string().optional(),
	tunnelName: z.string().default("whipped"),
	// Auth: single shared password (scrypt hash) + HMAC secret for signed session
	// cookies + machine token for local agent machinery (MCP/hooks). Never expose
	// these over the API — see configController's response.
	authPasswordHash: z.string().optional(),
	authSessionSecret: z.string().optional(),
	authMachineToken: z.string().optional(),
});
export type RuntimeGlobalConfig = z.infer<typeof runtimeGlobalConfigSchema>;

// ─── Per-project config ───────────────────────────────────────────────────────

export const runtimeGithubConfigSchema = z.object({
	token: z.string(),
});
export type RuntimeGithubConfig = z.infer<typeof runtimeGithubConfigSchema>;

// A path to bring into a new worktree. `symlink: true` links it (junction on
// Windows for dirs) instead of copying — lets large reusable dirs like
// node_modules / vendor be shared from the repo with ~zero disk/time cost.
export const runtimeWorktreeCopyEntrySchema = z.object({
	path: z.string().min(1),
	symlink: z.boolean().default(false),
});
export type RuntimeWorktreeCopyEntry = z.infer<typeof runtimeWorktreeCopyEntrySchema>;

export const runtimeWorktreeSetupSchema = z.object({
	// Legacy configs stored bare strings; accept and normalize them to copy entries.
	filesToCopy: z
		.array(z.union([z.string().transform((path) => ({ path, symlink: false })), runtimeWorktreeCopyEntrySchema]))
		.default([]),
	installCommand: z.string().default(""),
});
export type RuntimeWorktreeSetup = z.infer<typeof runtimeWorktreeSetupSchema>;

export const runtimeProjectSecretSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});
export type RuntimeProjectSecret = z.infer<typeof runtimeProjectSecretSchema>;

export const BUILTIN_SECRET_KEYS = ["GITHUB_TOKEN"] as const;
export type BuiltinSecretKey = (typeof BUILTIN_SECRET_KEYS)[number];

export const runtimeProjectConfigSchema = z.object({
	name: z.string().optional(),
	defaultAgent: runtimeAgentIdSchema.optional(),
	maxParallelTasks: z.number().int().positive().optional(),
	maxAutoFixAttempts: z.number().int().nonnegative().optional(),
	pollingIntervalSeconds: z.number().int().positive().optional(),
	// What happens when a card passes review (polling/dispatch is always on; per-ticket
	// readyForDev gates pickup). "off" parks it in ready_for_review, "pr" auto-creates a
	// GitHub PR, "yolo" merges the branch straight into the local baseRef and pushes.
	deliveryMode: z.enum(["off", "pr", "yolo"]).default("off"),
	autoCommit: z.boolean().default(true),
	defaultBaseBranch: z.string().optional(),
	github: runtimeGithubConfigSchema.optional(),
	worktreeSetup: runtimeWorktreeSetupSchema.optional(),
	startCommand: z.string().default(""),
	workflows: z.array(workflowSchema).default([]),
	secrets: z.array(runtimeProjectSecretSchema).default([]),
	systemPrompt: z.string().optional(),
	// Freeform instructions injected into the dev agent's prompt to shape PR
	// titles, descriptions, and commit messages. Empty/absent → daemon falls
	// back to DEFAULT_GIT_INSTRUCTIONS.
	gitInstructions: z.string().optional(),
	// Which agent binary/model/effort the assistant agent runs as. Absent → claude.
	assistantModel: agentModelChoiceSchema.optional(),
});
export type RuntimeProjectConfig = z.infer<typeof runtimeProjectConfigSchema>;

// ─── Workspace state ─────────────────────────────────────────────────────────

export const runtimeWorkspaceStateResponseSchema = z.object({
	workspaceId: z.string(),
	repoPath: z.string(),
	board: runtimeBoardDataSchema,
	revision: z.number(),
	projectConfig: runtimeProjectConfigSchema,
});
export type RuntimeWorkspaceStateResponse = z.infer<typeof runtimeWorkspaceStateResponseSchema>;

export const runtimeWorkspaceStateSaveRequestSchema = z.object({
	board: runtimeBoardDataSchema,
	revision: z.number(),
});
export type RuntimeWorkspaceStateSaveRequest = z.infer<typeof runtimeWorkspaceStateSaveRequestSchema>;

// ─── Card mutations ──────────────────────────────────────────────────────────

export const runtimeVisualElementSchema = z.object({
	elementSelector: z.string().optional(),
	elementText: z.string().optional(),
	componentName: z.string().optional(),
	componentChain: z.array(z.string()).optional(),
	sourceFile: z.string().optional(),
	sourceLine: z.number().optional(),
	// The page the element was captured on. Selections can span pages, so this is
	// per-element rather than relying on the visualComment-level pageUrl.
	pageUrl: z.string().optional(),
});
export type RuntimeVisualElement = z.infer<typeof runtimeVisualElementSchema>;
export const runtimeVisualCommentSchema = z.object({
	pageUrl: z.string().optional(),
	elements: z.array(runtimeVisualElementSchema).default([]),
});
export type RuntimeVisualComment = z.infer<typeof runtimeVisualCommentSchema>;

export const runtimeCardCreateRequestSchema = z.object({
	description: z.string(),
	type: cardTypeSchema.optional(),
	// Browser-extension element references; folded into the description server-side.
	visualComment: runtimeVisualCommentSchema.optional(),
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	readyForDev: z.boolean().optional(),
	dependsOn: z.string().optional(),
	waitsFor: z.array(z.string()).optional(),
	subtaskIds: z.array(z.string()).optional(),
	columnId: runtimeBoardColumnIdSchema.optional(),
	baseRef: z.string().optional(),
	githubIssueUrl: z.string().optional(),
	workflowId: z.string().optional(),
	descriptionAttachments: z.array(reviewAttachmentSchema).optional(),
	branchName: z.string().optional(),
	// Optional per-ticket overrides edited before creation. When omitted, the card
	// snapshots the resolved workflow's pairs and defaults the active level to the
	// workflow's highest configured tier.
	modelConfig: cardModelConfigSchema.optional(),
	activeLevel: tierLevelSchema.optional(),
});
export type RuntimeCardCreateRequest = z.infer<typeof runtimeCardCreateRequestSchema>;

// One ticket in a bulk import. Same shape as a single create, plus an optional
// tempId so rows can reference each other (dependsOn/waitsFor/subtaskIds may name
// a sibling's tempId, resolved to the real id during the batch insert).
export const runtimeBulkCardImportItemSchema = runtimeCardCreateRequestSchema.extend({
	tempId: z.string().optional(),
});
export type RuntimeBulkCardImportItem = z.infer<typeof runtimeBulkCardImportItemSchema>;

export const runtimeBulkCardsCreateRequestSchema = z.object({
	// Batch-wide base branch; an item's own baseRef overrides it, else resolved server-side.
	baseRef: z.string().optional(),
	cards: z.array(runtimeBulkCardImportItemSchema).min(1),
});
export type RuntimeBulkCardsCreateRequest = z.infer<typeof runtimeBulkCardsCreateRequestSchema>;

export const runtimeCardMoveRequestSchema = z.object({
	cardId: z.string(),
	targetColumnId: runtimeBoardColumnIdSchema,
	targetIndex: z.number().int().nonnegative().optional(),
	revision: z.number(),
});
export type RuntimeCardMoveRequest = z.infer<typeof runtimeCardMoveRequestSchema>;

export const runtimeCardUpdateRequestSchema = z.object({
	cardId: z.string(),
	description: z.string().optional(),
	descriptionAttachments: z.array(reviewAttachmentSchema).optional(),
	type: cardTypeSchema.optional(),
	agentId: runtimeAgentIdSchema.optional(),
	priority: runtimeCardPrioritySchema.optional(),
	readyForDev: z.boolean().optional(),
	dependsOn: z.string().optional(),
	waitsFor: z.array(z.string()).optional(),
	subtaskIds: z.array(z.string()).optional(),
	workflowId: z.string().optional(),
	branchName: z.string().optional(),
	plan: z.string().optional(),
	activeLevel: tierLevelSchema.optional(),
	modelConfig: cardModelConfigSchema.optional(),
	revision: z.number(),
});
export type RuntimeCardUpdateRequest = z.infer<typeof runtimeCardUpdateRequestSchema>;

// ─── Memory ───────────────────────────────────────────────────────────────────

export const memoryScopeSchema = z.enum(["global", "project"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryTypeSchema = z.enum([
	"fact",
	"convention",
	"decision",
	"preference",
	"rule",
	"lesson",
	"sharp_edge",
]);
export type MemoryType = z.infer<typeof memoryTypeSchema>;

export const MEMORY_TYPE_OPTIONS: ReadonlyArray<{ value: MemoryType; label: string }> = [
	{ value: "fact", label: "Fact" },
	{ value: "convention", label: "Convention" },
	{ value: "decision", label: "Decision" },
	{ value: "preference", label: "Preference" },
	{ value: "rule", label: "Rule" },
	{ value: "lesson", label: "Lesson" },
	{ value: "sharp_edge", label: "Sharp edge" },
];

export const memorySourceTypeSchema = z.enum(["user_correction", "explicit_save", "task_lesson", "manual_human"]);
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;

export const memoryStatusSchema = z.enum(["pending", "approved"]);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

export const runtimeMemoryOriginAgentSchema = z.object({
	agent: z.string(),
	model: z.string().optional(),
});
export type RuntimeMemoryOriginAgent = z.infer<typeof runtimeMemoryOriginAgentSchema>;

export const runtimeMemorySchema = z.object({
	id: z.string(),
	scope: memoryScopeSchema,
	workspaceId: z.string().nullable(),
	originWorkspaceId: z.string().nullable().optional(),
	type: memoryTypeSchema,
	title: z.string(),
	content: z.string(),
	sourceType: memorySourceTypeSchema,
	importance: z.number().int().min(1).max(3).default(1),
	tags: z.array(z.string()).default([]),
	boundWorkspaceIds: z.array(z.string()).default([]),
	originCardId: z.string().nullable().optional(),
	originAgent: runtimeMemoryOriginAgentSchema.nullable().optional(),
	status: memoryStatusSchema.default("approved"),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type RuntimeMemory = z.infer<typeof runtimeMemorySchema>;

// Canonical, kebab-case tag names. Routing of global memory to projects is by
// tag intersection — see docs/memory-tags.md.
export function normalizeTag(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// ─── Recurring agents ──────────────────────────────────────────────────────────
// Scheduled, one-shot observer agents created by the assistant (never by
// themselves). They read the board and report (no code-write tools) and keep a
// private `journal` carried across runs. Unlike workflow slots, a recurring
// agent runs exactly one fixed model — no level resolution.

export const recurringScheduleKindSchema = z.enum(["interval", "calendar"]);
export type RecurringScheduleKind = z.infer<typeof recurringScheduleKindSchema>;

// interval  — run every `intervalSeconds` (stored in seconds; UI offers friendly units).
// calendar  — wall-clock recurrence via cron in a timezone ("every Monday 9am").
export const recurringScheduleSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("interval"), intervalSeconds: z.number().int().positive() }),
	z.object({ kind: z.literal("calendar"), cronExpr: z.string().min(1), timezone: z.string().min(1) }),
]);
export type RecurringSchedule = z.infer<typeof recurringScheduleSchema>;

export const recurringRunStatusSchema = z.enum(["running", "ok", "error", "killed"]);
export type RecurringRunStatus = z.infer<typeof recurringRunStatusSchema>;

export const recurringRunTriggerSchema = z.enum(["schedule", "manual"]);
export type RecurringRunTrigger = z.infer<typeof recurringRunTriggerSchema>;

export const recurringAgentRunSchema = z.object({
	id: z.string(),
	startedAt: z.number(),
	endedAt: z.number().optional(),
	status: recurringRunStatusSchema,
	summary: z.string().optional(),
	tokens: z.number().optional(),
	trigger: recurringRunTriggerSchema.default("schedule"),
	streamId: z.string().optional(),
});
export type RecurringAgentRun = z.infer<typeof recurringAgentRunSchema>;

export const recurringAgentSchema = z.object({
	id: z.string(),
	name: z.string(),
	instructions: z.string().default(""),
	schedule: recurringScheduleSchema,
	model: agentModelChoiceSchema,
	enabled: z.boolean().default(true),
	lastRunAt: z.number().optional(),
	nextRunAt: z.number().optional(),
	journal: z.string().default(""),
	createdAt: z.number(),
	updatedAt: z.number(),
	recentRuns: z.array(recurringAgentRunSchema).default([]),
});
export type RecurringAgent = z.infer<typeof recurringAgentSchema>;

export const recurringAgentCreateRequestSchema = z.object({
	name: z.string().min(1),
	instructions: z.string().optional(),
	schedule: recurringScheduleSchema,
	model: agentModelChoiceSchema.optional(),
	enabled: z.boolean().optional(),
});
export type RecurringAgentCreateRequest = z.infer<typeof recurringAgentCreateRequestSchema>;

export const recurringAgentUpdateRequestSchema = z.object({
	id: z.string(),
	name: z.string().min(1).optional(),
	instructions: z.string().optional(),
	schedule: recurringScheduleSchema.optional(),
	model: agentModelChoiceSchema.optional(),
	enabled: z.boolean().optional(),
	journal: z.string().optional(),
});
export type RecurringAgentUpdateRequest = z.infer<typeof recurringAgentUpdateRequestSchema>;

// ─── Companion agent ───────────────────────────────────────────────────────────
// A synchronous, chat-driven coding session — unlike the ticket pipeline, no card
// is involved and nothing here is async. The user drives it directly, then
// merges/PRs when done. `seedPrompt` is a snapshot of the chosen workflow's
// dev-slot prompt at creation time (not re-resolved live, so editing/deleting
// that workflow later never changes a running session).
//
// `useWorktree` picks the isolation mode: true creates a dedicated git worktree
// on `branchName` (branched from `baseRef`); false works directly in the
// project's main repo checkout — no worktree, no new branch, `branchName` is
// null, and worktree-only actions (merge, discard-worktree) don't apply.
// `baseRef` is always set (defaults to the project's configured base branch) —
// it's also the diff comparison ref in both modes.

export const companionSessionStatusSchema = z.enum(["installing", "running", "stopped", "merged", "discarded"]);
export type CompanionSessionStatus = z.infer<typeof companionSessionStatusSchema>;

export const companionSessionSchema = z.object({
	id: z.string(),
	name: z.string(),
	useWorktree: z.boolean(),
	baseRef: z.string(),
	branchName: z.string().nullable(),
	worktreePath: z.string().nullable(),
	workflowId: z.string().nullable(),
	seedPrompt: z.string().default(""),
	agentId: runtimeAgentIdSchema,
	model: z.string().nullable(),
	effort: effortLevelSchema.nullable(),
	status: companionSessionStatusSchema.default("stopped"),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type CompanionSession = z.infer<typeof companionSessionSchema>;

export const companionSessionCreateRequestSchema = z.object({
	name: z.string().optional(),
	useWorktree: z.boolean().default(true),
	baseRef: z.string().min(1),
	branchName: z.string().optional(),
	workflowId: z.string().optional(),
	model: agentModelChoiceSchema.optional(),
});
export type CompanionSessionCreateRequest = z.infer<typeof companionSessionCreateRequestSchema>;

// ─── WebSocket events ─────────────────────────────────────────────────────────

export type RunSessionStatus = "running" | "stopped" | "error";

export type RuntimeStateEvent =
	| { type: "snapshot"; state: RuntimeWorkspaceStateResponse }
	| { type: "workspace_updated"; state: RuntimeWorkspaceStateResponse }
	| { type: "terminal_output"; taskId: string; data: string }
	| { type: "run_session_changed"; cardId: string | null; status: RunSessionStatus; errorMessage?: string }
	| { type: "update_available"; latestVersion: string };

// ─── Projects layout ─────────────────────────────────────────────────────────

export const projectFolderSchema = z.object({
	id: z.string(),
	name: z.string(),
	collapsed: z.boolean().default(false),
	projectIds: z.array(z.string()),
});

export const topLevelItemSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("folder"), id: z.string() }),
	z.object({ type: z.literal("project"), workspaceId: z.string() }),
]);

export const projectsLayoutSchema = z.object({
	version: z.literal(1),
	topLevel: z.array(topLevelItemSchema),
	folders: z.record(z.string(), projectFolderSchema),
});
export type ProjectsLayout = z.infer<typeof projectsLayoutSchema>;

// ─── Project ──────────────────────────────────────────────────────────────────

export const runtimeProjectSchema = z.object({
	workspaceId: z.string(),
	repoPath: z.string(),
	name: z.string(),
	lastUpdated: z.number(),
});
export type RuntimeProject = z.infer<typeof runtimeProjectSchema>;
