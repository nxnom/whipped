# Future Plans

Candidate features for whipped. Not committed — captured here so they aren't lost.

## Missing or partial

1. **Cost & token tracking** — fully missing. No usage metrics on tasks. Surface $ spent and tokens per card/agent, with optional budgets that pause an agent when exceeded.

2. **Task templates / recipes** — no mechanism to save a (workflow + prompt + agent + model + effort) bundle as a reusable template (e.g. "bugfix", "feature spike", "refactor").

3. **Auto-retry on dev failure** — only review slots retry via `maxAutoFixAttempts`. A dev agent that exits non-zero or crashes doesn't auto-requeue. Extend retry policy to dev slots.

4. **Parallel subtask execution** — subtasks exist as data (`createStoryBatch` in `src/mcp/kanban-mcp-server.ts`), but the orchestrator runs them sequentially. Add concurrent fan-out across worktrees for independent subtasks, then converge.

5. **Slack interactivity** — `src/slack/slack-notifier.ts` is one-way (notifications only). Add slash commands, "create card from thread", and approve/reject buttons on PR / review messages.

6. **CI awareness** — `src/github/github-client.ts` doesn't poll Actions status. Read GitHub Actions results on an agent's PR and feed failures back as a follow-up turn automatically.

7. **Human-in-the-loop checkpoint slot** — no workflow slot type that pauses for human approval/edits before continuing the pipeline.

8. **Linear support** — only Jira (`src/jira/jira-client.ts`) exists. Add a Linear client alongside it.

9. **Multi-user mode** — single daemon, single machine. No per-user credentials, sharing, or access control. Add team workspace mode.

10. **Worktree GC / disk usage panel** — `~/.whipped/worktrees/` has no sweep for merged/abandoned branches and no UI for disk usage.

11. **Full daemon restart replay** — only the review pipeline resumes (`src/daemon/review-pipeline.ts`); in-flight dev sessions aren't restored after a daemon restart.

## Bigger swings (new capabilities, not gap-fills)

1. **Persistent codebase memory layer.** Every task starts cold today — the agent re-reads the repo from scratch. A shared knowledge store (embeddings index of the code, distilled summaries of past completed tasks, project conventions) every agent consults. Tradeoff: real ongoing infra (embeddings, freshness, eviction); biggest quality multiplier across all workflows.

2. **Spec-first workflow stage.** Add a "Design" slot upstream of Dev that produces a short RFC/spec (interfaces, files to touch, test plan) the human can edit and the dev agent is constrained to follow. Orchestrator splits stories but there's no design-before-code phase. Tradeoff: extra latency per task; sharply reduces scope creep and wrong-direction failures.

3. **Self-verifying agents — sandbox + browser.** QA slot that boots the app in an ephemeral environment (Docker/Playwright), exercises the change, and attaches screenshots + console logs as proof. Current QA slot is just another LLM call. Tradeoff: needs per-project run config and a sandbox runner; turns "agent claims done" into "agent proves done."

4. **Auto-triaged inbound queue.** Wire Sentry / PagerDuty / CI failures / error monitors → cards auto-created, deduped, and routed to a workflow without a human writing the ticket. Tradeoff: needs robust dedup and priority logic; reframes the product from "I assign work" to "the system surfaces and resolves work."

5. **Scheduled / recurring autonomous agents.** Cron-driven cards: weekly dep upgrades, daily Sentry triage, monthly lint/tech-debt sweep, quarterly perf audit. Lives in whipped (distinct from user-level `/schedule` skill). Tradeoff: lots of "nothing changed" noise to manage; eliminates chore tickets entirely.

6. **A/B agent evaluation harness.** Run the same task across N agent/model/effort configs in parallel worktrees, diff the outputs, judge agent (or human) picks the winner. Over time builds a dataset of "which config wins for which task type" → routing recommendations. Tradeoff: 3-5x cost per task while running; turns every task into training signal.

7. **Multi-repo cards.** One ticket spans `api` + `web` + `infra` repos, with linked branches/PRs and cross-repo dependency awareness in the worktree manager. Today each card is single-repo. Tradeoff: significant rework of the worktree + git layer; unlocks full-stack feature class.

**Top-pick reasoning:** #1 (memory) lifts every other feature; #4 (auto-triaged inbound) changes what the product *is*.

## Already implemented (for reference, don't re-propose)

- Diff viewer — `web-ui/src/components/kanban/DiffView.tsx` (file tree, hunks, per-line comments)
- Slack notifications — `src/slack/slack-notifier.ts` (card create, column change, PR, review comments)
- Subtask card type + orchestrator batch creation — `src/mcp/kanban-mcp-server.ts` `createStoryBatch`
- Partial crash recovery — `src/daemon/review-pipeline.ts` resumes killed sessions, skips passed review slots
- Auto-retry on review failure — `maxAutoFixAttempts` config

## Suggested priority

Highest impact-for-effort, each plugging a gap in an otherwise-complete subsystem:
1. Cost tracking (#1)
2. Auto-retry on dev (#3)
3. Slack slash commands (#5)
4. Approval slot (#7)
5. Worktree GC (#10)
