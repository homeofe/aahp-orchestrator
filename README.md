# AAHP Orchestrator

> VS Code extension — orchestrate GitHub Copilot and Claude Code with AAHP v3 context. Zero questions. Full context. Both agents know what to do.

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-blue)](https://code.visualstudio.com/)
[![AAHP v3](https://img.shields.io/badge/AAHP-v3-green)](https://github.com/homeofe/AAHP)

---

## The Problem

Both GitHub Copilot and Claude Code start every session cold. They ask:
- "What does this project do?"
- "Which file should I change?"
- "What conventions do you follow?"
- "Should I proceed?"

Your **AAHP v3 handoff files** already have all the answers. This extension makes both agents read them — automatically.

---

## How it works

When you open a workspace with `.ai/handoff/MANIFEST.json`:

1. The **status bar** shows your current phase and active task
2. A **context banner** offers to copy AAHP context to clipboard with one click
3. Use `@aahp` in any VS Code chat (Copilot or Claude) — full AAHP context is injected automatically as a system prompt before every message
4. The **sidebar dashboard** shows all tasks, phase, last agent, and quick-action buttons

---

## Features

| Feature | Details |
|---------|---------|
| `@aahp` chat participant | Context-aware proxy in VS Code chat. Reads MANIFEST.json, injects phase + tasks + conventions + trust as system prompt. No cold starts. |
| Live status bar | `[impl] T-003: Fix CORS` — updates on every manifest change |
| Sidebar dashboard | Full AAHP state: tasks, phase, agent, quick_context, action buttons |
| Auto context banner | On workspace open: offers to copy AAHP context to clipboard |
| `Ctrl+Alt+A` | Copy full AAHP context to clipboard (paste into any chat) |
| Update Manifest | Refreshes all SHA-256 checksums + line counts in MANIFEST.json |
| Commit Session | Stages `.ai/handoff/` and commits with one command |
| Set Phase | Quick-pick to switch: research / architecture / implementation / review / fix / release |

---

## Requirements

- VS Code ≥ 1.90
- A workspace with `.ai/handoff/MANIFEST.json` ([AAHP v3 spec](https://github.com/homeofe/AAHP))
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

The agent already knows your project, phase, conventions, and trust state — no explanation needed.

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

## License

MIT © [homeofe](https://github.com/homeofe)
