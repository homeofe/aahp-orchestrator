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
| **aahp-orchestrator** ← you are here | VS Code extension. Injects AAHP context into Copilot/Claude Code while *you* code. Live status bar, `@aahp` chat, sidebar dashboard. | Every coding session - your human-in-the-loop assistant. |
| **[aahp-runner](https://github.com/elvatis/aahp-runner)** | Autonomous CLI. Spawns Claude agents that implement tasks, run tests, and commit - no human input needed. Schedulable. | Overnight / CI - your unattended worker. |

Together they cover the full AAHP loop: you plan and guide during the day → the runner works through tasks at night → you wake up to committed progress.

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

---

## Features

| Feature | Details |
|---------|---------|
| `@aahp` chat participant | Context-aware proxy in VS Code chat. Reads MANIFEST.json, injects phase + tasks + conventions + trust as system prompt. No cold starts. |
| Live status bar | `[impl] T-003: Fix CORS` - updates on every manifest change |
| Sidebar dashboard | Full AAHP state: tasks, phase, agent, quick_context, action buttons |
| Auto context banner | On workspace open: offers to copy AAHP context to clipboard |
| `Ctrl+Alt+A` | Copy full AAHP context to clipboard (paste into any chat) |
| Update Manifest | Refreshes all SHA-256 checksums + line counts in MANIFEST.json |
| Commit Session | Stages `.ai/handoff/` and commits with one command |
| Set Phase | Quick-pick to switch: research / architecture / implementation / review / fix / release |

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
- GitHub Copilot (for `@aahp` chat responses via LM API)

---

## Usage

### @aahp in chat
Open Copilot Chat or any VS Code chat panel and type:
```
@aahp implement the top task
@aahp what's blocking T-003?
@aahp update MANIFEST.json with my progress
```

The agent already knows your project, phase, conventions, and trust state - no explanation needed.

### Commands (Ctrl+Shift+P)
```
AAHP: Open Dashboard
AAHP: Copy Context to Clipboard    (Ctrl+Alt+A)
AAHP: Update Manifest Checksums
AAHP: Commit Session
AAHP: Set Phase
```

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
