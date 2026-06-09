<p align="center">
  <img src="https://raw.githubusercontent.com/nxnom/whipped/develop/logo.png" width="120" alt="whipped logo" />
</p>

<h1 align="center">whipped</h1>

<p align="center">
  Autonomous AI agent kanban board. You create tickets, the agents do the work — because they have no choice.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/whipped"><img src="https://img.shields.io/npm/v/whipped" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/whipped"><img src="https://img.shields.io/npm/dm/whipped" alt="npm downloads" /></a>
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
# Open the board in the foreground (prints URL; use Ctrl+C to stop)
whipped
whipped --port 3000       # default: 50008
whipped --host 0.0.0.0   # default: 127.0.0.1

# Run as a detached background daemon
whipped start
whipped start --port 3000 --host 0.0.0.0

# Stop the daemon
whipped stop

# Restart the daemon
whipped restart

# Check daemon status (URL, PID, uptime)
whipped status

# Tail live logs
whipped logs -f
whipped logs -n 500       # last 500 lines (default: 200)

# Set or change the web UI login password
whipped auth set-password
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

## Features

### Kanban board

- Columns: **Backlog → In Progress → Ready for Review → Blocked → Reopened → Done**
- Card types: **task**, **story**, **subtask**
- Priority levels per card
- Card dependencies — a card can block another (`depends_on`) or wait for multiple cards (`waitsFor`)
- Drag-and-drop column management
- Per-card activity log tracking all status changes, PR links, and agent messages

### Workflows

Workflows define a pipeline of agent slots that run sequentially on each task. Slot types:

- **Plan** — one-shot planner that runs before dev and saves a structured plan onto the card (visible in the **Plan** tab). Off by default.
- **Dev** — implements the task; the only slot with write access to the worktree.
- **Review** — one-shot reviewer. Multiple review slots can be chained (Dev → Review → Review…), each with its own prompt, tools, and model. A dedicated QA slot can be given **browser control** (Playwright MCP) to drive the running app during review.
- **Orchestrator** — story-only slot that breaks a story into subtasks and fires them as separate cards for dev agents to pick up.

Each slot is independently configurable with its own agent binary, model pairs, capability level, granted tools, and system prompt. Prompt instructions can also be loaded from an external `.md` file in the repo (linked via the slot editor), keeping long prompts version-controlled outside the UI.

#### Capability levels & multi-model slots

Each workflow slot holds a set of model **pairs**, every pair tagged with a capability level — **minimal, low, medium, high, max** — and a free/paid flag. The card carries one workflow-wide active level, and each slot resolves that level to its own pair (with nearest-level fallback and a free-first preference). This lets a single level knob drive different models per slot — e.g. a cheap model for review, a smarter one for dev.

The active level can be overridden per card before it starts, and the review agent can re-select it on reopen (e.g. drop a trivial fix to **minimal**) so follow-up runs don't burn the top tier.

### Git worktree isolation

Each task runs in its own git worktree so multiple agents work in parallel without interfering. Branches follow the `task/<id>` naming convention. Dirty state is auto-committed as a WIP snapshot before review.

#### Worktree setup

Configure a per-project setup routine that runs every time a new worktree is created:

- **Install command** — e.g. `pnpm install --frozen-lockfile`
- **Files to copy** — dotfiles, `.env.local`, or any file that shouldn't be in version control but is needed to run the project
- **Start command** — launches the dev server so QA review slots can drive the running app

### Delivery modes

Controls what happens after a card passes review:

- **Off** — card moves to Ready for Review and waits for a human to merge
- **Auto PR** — creates a GitHub pull request automatically
- **YOLO** — merges the branch directly into the base branch and pushes; no PR, no human approval

In YOLO mode, whipped serialises merges per base ref to prevent race conditions. If a merge hits conflicts, a conflict-resolution agent is spawned automatically to fix them before retrying.

### Live terminal view

Every agent session streams its terminal output to the board UI in real time. Sessions are replayable from the card detail view after the agent has finished.

### Memory system

A durable knowledge base that agents draw on across tasks so they stop re-discovering the same facts about the codebase.

- **Propose & approve** — agents propose memories during their work; a human approves before they become available to future runs
- **Scopes** — memories can be global (all projects) or scoped to a single project
- **Tags** — memories are tagged; each workspace subscribes to the tags its agents should recall
- **Search** — browse, filter, and manage the memory bank from Project Settings → Memory
- **Card recall** — agents can search memories relevant to the specific card they are working on

### Recurring agents

Recurring agents run on a schedule to observe the project and report findings as kanban cards — no human trigger required.

- **Schedules** — interval-based (e.g. every 6 hours) or calendar cron with timezone support
- **Read-only by design** — no file writes or shell commands; findings are filed as backlog cards via `kanban_create_card` for the dev agent to pick up
- **Journal** — each agent keeps a private scratchpad that persists across runs so it avoids re-filing issues it already reported
- **Run history** — every run records status, a tail summary, and the full replayable terminal output
- **Configurable per agent** — each recurring agent picks its own model, capability level, and instructions independently of any workflow
- **Manual trigger** — "Run now" fires an out-of-schedule run without advancing the schedule

#### Secrets & external service access

Project secrets (see below) are injected into the agent's environment at run time, so recurring agents can authenticate against any external API. For Claude Code and Codex you can also point them at a custom MCP server — giving the agent structured tools to query third-party services rather than shelling out.

Combined, this makes recurring agents a general-purpose import layer. Examples:

- **Jira / Linear / Monday.com** — pull open issues from your project management tool and create matching backlog cards, skipping anything already in the journal
- **Sentry / Datadog** — surface new error spikes or alert regressions as `bug` cards ready for the dev agent
- **GitHub** — import issues, triage open PRs, or flag stale branches
- **Any REST API** — authenticate with a secret token and query whatever data your workflow needs

Pair a recurring agent with a secret token and the right instructions, and any external source of work becomes a first-class citizen on the board.

### Secrets management

Per-project secrets (API keys, tokens) are stored locally, encrypted at rest, and injected into every agent's environment at run time. A `.env` paste UI lets you bulk-import from an existing env file. `GITHUB_TOKEN` is a built-in key with special handling (PR creation, polling).

### GitHub integration

- Auto-creates pull requests when a dev slot completes (requires `GITHUB_TOKEN`)
- Links cards to GitHub issues
- Posts PR status updates as card activity
- Polls open PRs for review comments and syncs them back as inline card comments

### Slack integration

- Sends notifications to a channel when cards are created, change status, get a PR, or receive review comments
- Setup wizard creates and installs the Slack app from a single token — no manual OAuth configuration
- Requires the **Tunnel** feature (below) to receive Slack event callbacks when the board isn't publicly reachable

### Tunnel

Whipped can start a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose the local server publicly, enabling inbound webhooks from Slack, GitHub, or any external service. The tunnel can be set to start automatically with the daemon. Setup is guided from Global Settings → Tunnel.

### Browser extension — prompt creator

A standalone Chrome/Chromium extension for capturing UI context off any web page. Click the toolbar icon to enter select mode, then click any element to capture its React component and source location. It builds a ready-to-paste **YAML prompt** for your AI coding agent — no server connection required.

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/codkafoociihebdklkpfjjoacenkkhci?utm_source=item-share-cb), or build from source at [github.com/nxnom/whipped-extension](https://github.com/nxnom/whipped-extension).

### Visual comments

Comments on a card can carry visual context — a page URL plus the specific UI elements captured from a page — pasted straight into the composer. Whipped renders the captured elements inline so the agent sees exactly which parts of the UI a comment refers to.

### Multi-project support

Run whipped once per git repository, or manage multiple workspaces from a single board instance. Each workspace has its own board state, config, agent history, secrets, and memory bank.
