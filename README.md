# AAHP Orchestrator

> VS Code extension - orchestrate GitHub Copilot and Claude Code with AAHP v3 context. Zero questions. Full context. Both agents know what to do.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/elvatis.aahp-orchestrator?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=elvatis.aahp-orchestrator)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-blue)](https://code.visualstudio.com/)
[![AAHP v3](https://img.shields.io/badge/AAHP-v3-green)](https://github.com/elvatis/AAHP)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## The AAHP Toolchain

> **Install both packages for the full experience.**

| Package | What it does | When to use |
|---------|-------------|-------------|
| **aahp-orchestrator** - you are here | VS Code extension. Injects AAHP context into Copilot/Claude Code while *you* code. Live status bar, `@aahp` chat, sidebar dashboard. | Every coding session - your human-in-the-loop assistant. |
| **[aahp-runner](https://github.com/elvatis/aahp-runner)** | Autonomous CLI. Spawns Claude agents that implement tasks, run tests, and commit - no human input needed. Schedulable. | Overnight / CI - your unattended worker. |

Together they cover the full AAHP loop: you plan and guide during the day - the runner works through tasks at night - you wake up to committed progress.

---

## The Problem

Both GitHub Copilot and Claude Code start every session cold. They ask:
- "What does this project do?"
- "Which file should I change?"
- "What conventions do you follow?"
- "Should I proceed?"

Your **AAHP v3 handoff files** already have all the answers. This extension makes both agents read them - automatically.

---

## How it works

When you open a workspace with `.ai/handoff/MANIFEST.json`:

1. The **status bar** shows your current phase and active task
2. A **context banner** offers to copy AAHP context to clipboard with one click
3. Use `@aahp` in any VS Code chat (Copilot or Claude) - full AAHP context is injected automatically as a system prompt before every message
4. The **sidebar dashboard** shows all tasks, phase, last agent, and quick-action buttons
5. **Double-click any task** in the dashboard to spawn an agent that works on it
6. **Run All Agents** to process every repo's top task in parallel

---

## Features

| Feature | Details |
|---------|---------|
| `@aahp` chat participant | Context-aware proxy in VS Code chat. Reads MANIFEST.json, injects phase + tasks + conventions + trust as system prompt. No cold starts. |
| Live status bar | `[impl] T-003: Fix CORS` - updates on every manifest change |
| Sidebar dashboard | Full AAHP state: tasks, phase, agent, quick_context, action buttons |
| All Open Tasks tree | Aggregated view of all tasks across all repos, grouped by priority |
| Auto context banner | On first editor open: offers to copy AAHP context to clipboard |
| Multi-repo support | Set `aahp.developmentRoot: true` to scan all subdirectories for AAHP repos |
| Agent spawning | Run agents for all repos or a single focused repo from the dashboard |
| Fix Task (play button) | Click the play button next to any open task to spawn a targeted agent |
| Double-click to launch | Double-click any task in Next Steps or task table to start an agent |
| Dependency checking | When launching a task, warns about unresolved dependencies before proceeding |
| GitHub links | GH buttons next to tasks link directly to GitHub Issues search for that task ID |
| Agent retry | Failed agents can be retried with exponential backoff from the dashboard |
| Task creation | Create new tasks with title, priority, and dependencies from the dashboard |
| Task status editing | Change task status via dropdown in the task table |
| Token budget display | Shows token usage split between Claude and Copilot backends |
| Session monitoring | Displays active agent sessions, queued tasks, and completion status |

---

## Keyboard Shortcuts

| Shortcut | Command | Description |
|----------|---------|-------------|
| `Ctrl+Alt+A` | Copy Context to Clipboard | Copy full AAHP context for pasting into any chat |
| `Ctrl+Alt+D` | Open Dashboard | Open the AAHP sidebar dashboard |
| `Ctrl+Alt+R` | Run All Agents | Spawn agents for all repos with ready tasks |
| `Ctrl+Alt+S` | Run Single Repo | Spawn an agent for the currently focused repo |

---

## All Commands (Ctrl+Shift+P)

| Command | Description |
|---------|-------------|
| `AAHP: Open Dashboard` | Open the AAHP sidebar dashboard |
| `AAHP: Copy Context to Clipboard` | Copy full AAHP context (paste into any chat) |
| `AAHP: Update Manifest Checksums` | Refresh all SHA-256 checksums + line counts in MANIFEST.json |
| `AAHP: Commit Session` | Stage `.ai/handoff/` and commit with one command |
| `AAHP: Set Phase` | Quick-pick to switch: research / architecture / implementation / review / fix / release |
| `AAHP: Run All Agents` | Spawn agents for every repo with ready tasks |
| `AAHP: Run Agent for Current Repo` | Spawn an agent for the focused repo only |
| `AAHP: Focus Repo in Dashboard` | Switch the dashboard focus to a specific repo |
| `AAHP: Set Task Status` | Change a task's status (ready/in_progress/done/blocked/pending) |
| `AAHP: Create Task` | Add a new task with title, priority, and dependencies |
| `AAHP: Fix Task` | Spawn a targeted agent for a specific task |
| `AAHP: Retry Agent` | Retry a failed agent with exponential backoff |
| `AAHP: Refresh Dashboard` | Re-scan all repos and reload NEXT_ACTIONS.md |

---

## @aahp Chat Commands

Open Copilot Chat or any VS Code chat panel and type `@aahp` followed by a slash command:

| Command | Description |
|---------|-------------|
| `@aahp /help` | Show all available @aahp commands |
| `@aahp /status` | Show current status (phase, agent, context) |
| `@aahp /tasks` | List all tasks with status and priority |
| `@aahp /next` | What to work on next (top ready task) |
| `@aahp /context` | Full injected system prompt for debugging |
| `@aahp /phase` | Show or set the current development phase |
| `@aahp /done T-003` | Mark a task as done |

You can also use freeform messages:
```
@aahp implement the top task
@aahp what's blocking T-003?
@aahp update MANIFEST.json with my progress
```

The agent already knows your project, phase, conventions, and trust state - no explanation needed.

---

## Dashboard Interactions

The sidebar dashboard supports several interaction patterns:

| Action | Where | What happens |
|--------|-------|-------------|
| **Click a repo card** | Repo Grid section | Focuses that repo, showing its task table and project details |
| **Click play button** | Next to any open task | Spawns an agent to work on that specific task |
| **Click GH button** | Next to any task with ID | Opens GitHub Issues search for that task ID |
| **Double-click a task** | Next Steps or task table | Spawns an agent for that task (same as play button) |
| **Change status dropdown** | Task table, status column | Updates the task status in MANIFEST.json |
| **Click + New Task** | Bottom of task table | Opens dialog to create a new task |
| **Click Retry** | Failed agent card | Retries the failed agent with exponential backoff |
| **Click Run All Agents** | Top of dashboard | Runs agents for all repos in parallel |
| **Click Run [repo]** | Top of dashboard (when focused) | Runs agent for the focused repo only |
| **Click Refresh** | Next Steps section header | Re-scans all repos and reloads NEXT_ACTIONS.md |
| **Click section headers** | Any collapsible section | Collapse/expand that section |

### Dependency Warning

When you launch a task that has unresolved dependencies (`depends_on` in MANIFEST.json), the extension shows a warning dialog listing which dependencies are not yet done. You can choose to proceed anyway or cancel.

---

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aahp.developmentRoot` | boolean | `false` | Enable multi-repo mode: scans all subdirectories for `.ai/handoff/MANIFEST.json` |
| `aahp.rootFolderPath` | string | `""` | Override the root path to scan for repos (default: workspace root) |
| `aahp.suppressRootPrompt` | boolean | `false` | Suppress the initial prompt asking about development root mode |
| `aahp.agentBackend` | enum | `"auto"` | Agent backend: `auto` (try claude then copilot), `claude`, or `copilot` |
| `aahp.agentConcurrencyLimit` | number | `0` | Max parallel agents when running all repos (0 = unlimited) |
| `aahp.agentMaxRetries` | number | `1` | Max retry attempts on agent failure (uses exponential backoff) |

---

## Sidebar Views

The AAHP sidebar contains two views:

### Dashboard (webview)
The main interactive dashboard showing:
- **Agent Control** - Run All / Run Single buttons, active agent cards with status
- **Repo Grid** - All detected repos with health dots, phase badges, task counts
- **Next Steps** - Actionable items parsed from NEXT_ACTIONS.md across all repos
- **Focused Project** - Detailed view of the selected repo: task table, status, context
- **Quick Actions** - Checksums, Commit, Phase, Context buttons

### All Open Tasks (tree view)
A dedicated tree view showing all non-done tasks across all repos, grouped by priority (high/medium/low). Click any task to focus its repo in the dashboard.

---

## Installation

### From the VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+Shift+X` (Extensions sidebar)
3. Search for **AAHP Orchestrator**
4. Click **Install**

Or install from the command line:
```bash
code --install-extension elvatis.aahp-orchestrator
```

### From .vsix (manual)

Download the latest `.vsix` from [GitHub Releases](https://github.com/elvatis/aahp-orchestrator/releases), then:
```bash
code --install-extension aahp-orchestrator-0.3.0.vsix
```

---

## Requirements

- VS Code >= 1.90
- A workspace with `.ai/handoff/MANIFEST.json` ([AAHP v3 spec](https://github.com/elvatis/AAHP))
- GitHub Copilot extension (for `@aahp` chat responses via LM API) or Claude Code extension

---

## AAHP v3

This extension reads the following files from `.ai/handoff/`:

| File | Used for |
|------|----------|
| `MANIFEST.json` | Phase, tasks, quick_context, agent, checksums |
| `STATUS.md` | Current system state |
| `NEXT_ACTIONS.md` | Prioritized task list |
| `CONVENTIONS.md` | Code style, commit format, tooling |
| `TRUST.md` | What's verified vs assumed |
| `WORKFLOW.md` | Agent pipeline definition |

---

## Publishing

To publish a new version to the VS Code Marketplace:

1. Bump the version in `package.json`
2. Update `CHANGELOG.md`
3. Run `npm run publish` (requires `VSCE_PAT` environment variable)

Or via CI: push a `v*` tag to trigger the release workflow.

---

## License

MIT - [elvatis](https://github.com/elvatis)
