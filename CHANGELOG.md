# Changelog

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
