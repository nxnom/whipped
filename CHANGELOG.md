# Changelog

## [0.9.0] - 2026-07-01

### Added
- **Companion agent** — a new **Companion** page for pairing directly with a coding agent outside the
  ticket pipeline: no card, no queue, just a live chat-driven session. Starting one lets you pick an
  isolated git worktree (branched from a base ref, on a branch name you choose) or work directly in the
  main repo checkout with no worktree at all. Optionally seed the session from one of your configured
  workflows (copies its dev-slot prompt and pre-fills the model tier) — the workflow picker defaults to
  the project's default workflow instead of a blank agent. A new worktree runs the project's configured
  worktree-setup (file copy/link + install command) before the agent starts, streamed live into the
  session's terminal, same as a ticket's worktree setup. Each session has a diff tab, a Play button to run
  the project's start command, and Merge/Create PR actions (hidden when working directly in the main repo,
  since there's nothing to merge). Opening the Companion page with nothing selected jumps straight to the
  most recently active session. Deleting a session is permanent — it's removed from the list entirely,
  not just marked discarded.
- **Assistant chat model picker** — clicking the chat icon now shows a model picker before starting a
  session (skipped if a session is already running, which just reattaches). Previously the model was fixed
  from a Settings field with no way to change it per session; that field is now just the default.
- **Sonnet 5** added to the Claude model presets.

## [0.8.1] - 2026-06-27

- Fix navigation behaviour set to replace.

## [0.8.0] - 2026-06-24

### Added
- **Install command output is now traceable** — a task's worktree install command runs as a first-class
  step in the **Workflow Pipeline** sidebar (labelled "Install"), right alongside the agent runs. Its
  output streams live and stays rewatchable after it finishes, so a complex install script is no longer a
  black box visible only as a one-line "Install complete" in the activity log. Previously the command's
  output was discarded entirely. The install step can also be **stopped** from the sidebar like an agent;
  stopping it resets the task to its initial state (worktree removed, card back to Todo) so the next run
  starts fresh and re-runs the install.

## [0.7.0] - 2026-06-23

### Fixed
A round of Windows portability fixes — several features hardcoded Unix shells/tools that don't exist on
Windows, so they crashed with `File not found:` / `ENOENT` or silently no-op'd:
- **Agents failed to launch with "File not found:"** — agent processes are spawned through node-pty, whose
  Windows (conpty) backend does not search `PATHEXT` for a bare command name the way `child_process` does,
  so launching e.g. `claude` threw `File not found:` even when `claude.exe` was on `PATH`. The agent command
  is now resolved to its absolute executable path (via `where.exe`, preferring a native `.exe`) before
  spawning.
- **Run/preview commands and per-task install commands failed** — these were launched through `/bin/bash -c`
  / `sh -c`, which don't exist on Windows. A shared `getShellInvocation` helper now runs command strings
  through `cmd.exe /c` (via `ComSpec`) on Windows and `$SHELL -c` on POSIX.
- **`whipped logs --follow` crashed** — it shelled out to `tail -f`. On Windows it now follows the log via
  PowerShell `Get-Content -Wait -Tail`.
- **Windows Terminal / PowerShell were never detected** in the "Open in terminal" picker — detection used
  `which`, which doesn't exist on Windows; it now uses `where`.
- **Cloudflare tunnel login couldn't open the browser** — it spawned the macOS-only `open` command (with no
  error handler, risking an unhandled error event); it now uses the cross-platform `open` package.
- **Notification sounds were silent on Windows** — playback only supported macOS (`afplay`) and Linux
  (`paplay`); Windows now plays the WAV chimes via PowerShell's `SoundPlayer`.
- **Worktree cleanup failed with `EBUSY`** — removing a task's worktree directory could race the agent
  process's teardown; Windows refuses to delete a directory that is still any live process's working
  directory (unlike POSIX). Directory removal now retries with linear backoff (`fs.rm` `maxRetries`/
  `retryDelay`) to ride out the brief window between the agent being killed and its handles being released.

### Changed
- Moved the pnpm `onlyBuiltDependencies` and `overrides` settings out of `package.json` into
  `pnpm-workspace.yaml`, and pinned the toolchain with a `packageManager` field. pnpm 10+ no longer reads
  the `pnpm` field in `package.json`, which had silently disabled native-module builds (`better-sqlite3`,
  `node-pty`, `esbuild`) and the `hono` version override, causing failed installs and lockfile churn.

## [0.6.0] - 2026-06-23

### Added
- **Notification sounds** — Whipped can now play a sound on the machine running the daemon (so you hear it
  even when no browser is open) whenever a task needs your attention. A new **Settings → Notifications**
  section, off by default, has a master toggle plus a per-event switch for each of: a task moving to
  **Ready for Review**, a **new comment** on its PR, a PR being **merged** (Done), a task being **reopened**
  after changes were requested, a task becoming **blocked**, and a run/preview process **exiting with an
  error**. Each event has its own distinct chime.

## [0.5.1] - 2026-06-19

### Removed
- The Fable 5 model option from Claude's model presets.

## [0.5.0] - 2026-06-18

### Added
- **Bulk ticket import** — an Import button on the board opens a dialog where you can paste (or upload) a
  JSON array of tickets and create many at once. It shows a live preview with per-row validation, maps each
  ticket's `workflowId` (an omitted or unknown id falls back to the default workflow, flagged in the preview),
  and supports intra-batch relationships (`dependsOn`/`waitsFor`/`subtaskIds` referencing a sibling's `tempId`)
  plus stories and subtasks. The whole batch is created atomically — all-or-nothing. A **Copy prompt** button
  hands any AI assistant a schema-aware prompt (embedding the project's live workflow ids/names) so its
  fenced-JSON output pastes straight back in.
- The "update available" banner now has a **What's new** link to the changelog, so you can see what changed
  before updating.

### Fixed
- Story cards on the board now show their subtask progress (e.g. "3 subtasks · 1/3") — the indicator was
  reading `dependsOn`/`waitsFor`, which stories don't use, so it never rendered. Subtask cards now also show
  the parent story they belong to.

### Removed
- The parent-reopen cascade agent. Reopening a parent task no longer spawns an LLM agent that inspects the
  dependent child tickets, decides whether to reset them, and comments on each. Now that a dependent ticket
  shares its parent's worktree and branch, the child already sees the parent's changes directly — the agent's
  `git merge` remediation had become a no-op and its conflict-guessing was unreliable. To revise a child's
  work after changing a parent, mention it in the parent ticket (e.g. "update the consumer call sites too").
  This also drops the now-unused `kanban_stop_task` MCP tool and the `/cards/interrupt-task` endpoint.

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
