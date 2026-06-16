# Changelog

## [0.4.0] - 2026-06-16

### Added
- Recurring agents can now disable themselves via a `disable_self` MCP tool — useful for one-off
  scheduled tasks that should stop running once complete (the user can re-enable them later).
- Recurring agents now receive whipped's persistent project memory in their prompt (read-only),
  matching the dev and assistant agents, so observers are aware of existing conventions and decisions.
- mimo now starts with `--never-ask` and `--trust` so non-interactive runs don't block on the
  trust/ask prompts.

### Fixed
- The assistant agent no longer errors with a foreign-key constraint failure when saving a memory —
  its synthetic, card-less task id is no longer used as an `origin_card_id`, and a stale/unknown
  card id is dropped to null instead of failing the insert.
- Changing "Max Parallel Tasks" now takes effect without restarting the daemon — the poller re-syncs
  the concurrency limit from the latest project/global config each tick (previously it was frozen at
  startup).
- Visual comments are no longer lost when reopening a card via "Reopen / Request Changes" — the visual
  context is now carried through the human-feedback path, matching the "Send" path.

## [0.3.0] - 2026-06-13

### Added
- **mimo (mimocode) CLI** as a supported agent binary, alongside Claude Code, Codex, OpenCode, and Cursor.
  Includes dynamic model listing, per-task plugin/config isolation, read-only enforcement, and reasoning-effort
  (`--variant`) support for models that define it.

### Fixed
- Reasoning-effort levels are now passed to mimo using the model's own effort values
  (`low`/`medium`/`high`/`xhigh`/`max`) instead of the shifted OpenCode variant names.
- Database migrations no longer cascade-delete child rows when a table is rebuilt — foreign-key
  enforcement is disabled for the duration of the migration pass.

## [0.2.0] - 2026-06-10

### Added
- Fable 5 to the Claude model options.

### Fixed
- Conflict-resolution agent now injects its system prompt correctly.
- Hardened the memory-saving prompt.

## [0.1.0] - 2026-06-08

Initial release — a kanban board that creates, plans, runs, and reviews tickets handled by AI coding agents.

### Added
- **Agents:** Claude Code, OpenAI Codex, OpenCode, and Cursor agent, with custom models, effort levels,
  and per-ticket selection.
- **Workflows:** multi-model pipelines with intelligent capability-level selection, plus import/export.
- **Review pipeline:** plan / dev / review / QA agents; automatic PR creation, merge, conflict resolution,
  and auto commit & push.
- **Recurring agents:** scheduled, read-only runs (e.g. auto-importing tickets — replacing the Jira integration).
- **Browser-use MCP** for the QA agent.
- **MCP servers** for board management, attachments, system prompts, and workflows.
- **Tickets:** dependencies, priorities with project-level concurrency limits, stories/subtasks,
  image/file attachments, and custom worktree branches.
- **Workspace tooling:** diff view, terminal/session views, project secrets, and custom git instructions.
- **Chrome extension:** standalone prompt creator.
- **Memory** for durable context across runs.
- **Settings UI:** General & Automation, Environment & Secrets, Instructions, Integrations, Workflows,
  and Slack setup; redesigned board, ticket detail, and project-creation flows.
- **CLI** commands with prebuilt binaries, and an npm version check.
