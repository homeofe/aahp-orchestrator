# aahp-orchestrator: Current State of the Nation

> Last updated: 2026-02-27 by Claude Code
> Version: 0.2.0
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
> It reflects the *current* reality, not history. History lives in LOG.md.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `npm run compile` | verified | TypeScript to `out/`, 0 errors |
| `npm run lint` | verified | ESLint passes (0 errors, 53 warnings) |
| `vsce package` | verified | `aahp-orchestrator-0.2.0.vsix` exists |
| Extension activates | assumed | `onStartupFinished` trigger |

---

## Components

| Component | Path | State | Notes |
|-----------|------|-------|-------|
| Extension entry | `src/extension.ts` | assumed | Activate/deactivate lifecycle |
| AAHP file reader | `src/aahp-reader.ts` | assumed | Reads `.ai/handoff/` files |
| Context injector | `src/context-injector.ts` | assumed | Prepends AAHP context to AI prompts |
| Chat participant | `src/chat-participant.ts` | assumed | `@aahp` slash commands |
| Agent spawner | `src/agent-spawner.ts` | assumed | Launches Claude/Copilot agents |
| Commands | `src/commands.ts` | assumed | VS Code command palette entries |
| Session monitor | `src/session-monitor.ts` | assumed | Tracks agent session state |
| Sidebar | `src/sidebar.ts` | assumed | Activity bar webview panel |
| Status bar | `src/statusbar.ts` | assumed | Phase/task indicator in status bar |
| Webview | `src/webview/` | assumed | Dashboard HTML/CSS/JS |

---

## Infrastructure

| Component | State | Notes |
|-----------|-------|-------|
| VS Code Marketplace | not published | v0.2.0 packaged as .vsix |
| GitHub Releases | not tagged | Needs `git tag v0.2.0` + release |
| CI pipeline | added | `.github/workflows/ci.yml` - compile + lint on push/PR |

---

## What is Missing

| Gap | Severity | Description |
|-----|----------|-------------|
| CI pipeline | DONE | GitHub Actions workflow added (.github/workflows/ci.yml) |
| Automated tests | HIGH | No test suite visible |
| VS Code Marketplace publish | MEDIUM | .vsix packaged but not published |
| CHANGELOG.md | LOW | No changelog tracking versions |

---

## Recently Resolved

| Item | Resolution |
|------|-----------|
| v0.2.0 packaging | aahp-orchestrator-0.2.0.vsix built |
| Multi-root support | `aahp.developmentRoot` config added |
| Copilot + Claude backend | `aahp.agentBackend` auto/claude/copilot setting |
| AAHP protocol structure | `.ai/handoff/` created 2026-02-27 |

---

## Trust Levels

- **(Verified)**: .vsix files exist, package.json structure correct
- **(Assumed)**: all src/ components - derived from file names and package.json, not directly tested
- **(Verified)**: CI pipeline runs compile + lint
- **(Unknown)**: automated tests, marketplace publish status
