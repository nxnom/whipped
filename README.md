# whipped

Autonomous AI agent kanban board. You create tickets, the agents do the work — because they have no choice.

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

### Effort levels

All agents support effort overrides: **low, medium, high, extra high, max**. Mapped to each agent's native effort/variant flags.

## Features

### Kanban board

- Columns: **Backlog → In Progress → Ready for Review → Blocked → Reopened → Done**
- Card types: **task**, **story**, **subtask**
- Priority levels per card
- Card dependencies (blocks/blocked-by)
- Drag-and-drop column management

### Workflows

Workflows define a pipeline of agent slots that run sequentially on each task. Built-in workflow types:

- **Dev** — writes the code
- **Code Review** — reviews the diff
- **QA** — runs quality checks
- **Orchestrator** — breaks down a story into subtasks and coordinates agents
- **Custom** — arbitrary prompt with any agent

Default workflow: Dev → Code Review. QA is optional. Each slot is independently configurable with its own agent, model, effort level, and system prompt.

### Git worktree isolation

Each task runs in its own git worktree so multiple agents work in parallel without interfering. Branches follow the `task/<id>` naming convention. Dirty state is auto-committed as a WIP snapshot before review.

### Live terminal view

Every agent session streams its terminal output to the board UI in real time. Per-card activity log tracks status changes, PR links, and agent messages.

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
