<p align="center">
  <img src="web-ui/src/assets/logo.png" width="120" alt="whipped logo" />
</p>

<h1 align="center">whipped</h1>

<p align="center">
  Autonomous AI agent kanban board. You create tickets, the agents do the work — because they have no choice.
</p>

## Requirements

- Node.js ≥ 22
- A git repository (must be run from inside one)
- At least one supported agent installed and configured

## Install

```bash
npm install -g whipped
```

## Usage

```bash
# Open the board (foreground if not running, or opens browser if already running)
whipped

# Run as a background daemon
whipped start

# Stop the daemon
whipped stop

# Restart the daemon
whipped restart

# Check daemon status
whipped status

# Tail live logs
whipped logs -f
whipped logs -n 500       # last 500 lines

# Options (all commands)
whipped --port 3000       # default: 50008
whipped --host 0.0.0.0
whipped --no-open         # don't auto-open browser
```

## How it works

1. Run `whipped` inside a git repository — starts a local server and opens the kanban board.
2. Create a ticket, write a description, assign an agent.
3. The agent picks up the task, works in an isolated git worktree, and updates the board as it progresses.
4. Review the output in the live terminal view, then merge or reopen.

State is stored in `~/.whipped/`. Each agent session runs in its own worktree under `~/.whipped/worktrees/`.

## Supported agents

| Agent | CLI binary | Notes |
|---|---|---|
| **Claude Code** | `claude` | Full MCP + hooks integration |
| **OpenAI Codex** | `codex` | TOML `-c` overrides for hooks and MCP |
| **OpenCode** | `opencode` | Any provider/model string |
| **Cursor Agent** | `agent` | Fetches live model list from CLI |

Whipped detects which agents are installed at startup and only shows available ones in the UI. Multiple agents can run concurrently on different tasks.

### Model selection

- **Claude Code** — Opus 4.7, Opus 4.6, Sonnet 4.6, Sonnet 4.5, Haiku 4.5, or custom ID
- **Codex** — GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex, GPT-5.2, or custom
- **OpenCode** — free-form model string (any provider supported by opencode)
- **Cursor** — live model list fetched from the `agent models` CLI

### Capability levels & multi-model slots

Each workflow slot holds a set of model **pairs**, every pair tagged with a capability level — **minimal, low, medium, high, max** — and a free/paid flag. The card carries one workflow-wide active level, and each slot resolves that level to its own pair (with nearest-level fallback and a free-first preference). This lets a single level setting drive different models per slot — e.g. a cheap model for review, a smarter one for dev — without configuring each slot by hand.

The review agent can intelligently re-select the active level on reopen (e.g. drop a trivial fix to **minimal**), so follow-up work doesn't burn the top tier.

## Features

### Kanban board

- Columns: **Backlog → In Progress → Ready for Review → Blocked → Reopened → Done**
- Card types: **task**, **story**, **subtask**
- Priority levels per card
- Card dependencies (blocks/blocked-by)
- Drag-and-drop column management

### Workflows

Workflows define a pipeline of agent slots that run sequentially on each task. Slot types:

- **Plan** — one-shot planner that runs before dev and saves a plan onto the card (see the **Plan** tab in card detail). Off by default.
- **Dev** — implements the task; the only slot with write access to the worktree.
- **Review** — one-shot reviewer that replaces the old code-review/QA/custom slots. Several review slots can be chained (Dev → Review → Review…), each with its own prompt and per-slot tools (e.g. **browser control** for a QA pass that drives the running app).
- **Orchestrator** — story-only slot that breaks a story into subtasks and coordinates the agents working them.

Default workflow: Dev → Code Review, with optional Plan and QA (browser-enabled) slots. Each slot is independently configurable with its own agent, model pairs, capability level, granted tools, and system prompt.

### Git worktree isolation

Each task runs in its own git worktree so multiple agents work in parallel without interfering. Branches follow the `task/<id>` naming convention. Dirty state is auto-committed as a WIP snapshot before review.

### Live terminal view

Every agent session streams its terminal output to the board UI in real time. Per-card activity log tracks status changes, PR links, and agent messages.

### Browser extension — prompt creator

A standalone Chrome/Chromium extension (`extension/`) for capturing UI context off any web page. Click the toolbar icon to enter select mode, then click any element to capture its React component and source location. It builds a ready-to-paste **YAML prompt** for your AI coding agent — no server connection required. The toolbar icon is grayscale at rest and turns full color while select mode is active.

Load it unpacked from `chrome://extensions` (Developer mode → Load unpacked → pick the `extension/` folder).

### Visual comments

Comments on a card can carry visual context — a page URL plus the specific UI elements captured from a page — pasted straight into the composer. Whipped renders the captured elements inline so the agent sees exactly which parts of the UI a comment refers to.

### GitHub integration

- Auto-creates pull requests when a dev slot completes
- Links cards to GitHub issues
- Posts PR status updates as card activity
- Polls open PRs for review comments and syncs them back to the card

### Jira integration

- Imports tickets from a Jira project into the backlog
- Syncs ticket title, description, and status

### Secrets management

Per-project secrets (API keys, tokens) stored locally and injected into agent environments at runtime. Never committed to the repository.

### Multi-project support

Run whipped once per git repository, or manage multiple workspaces from a single board instance. Each workspace has its own board state, config, and agent history.
