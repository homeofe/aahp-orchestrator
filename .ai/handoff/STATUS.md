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
| `npm test` | verified | 72 tests pass (5 suites, Vitest) |
| `vsce package` | verified | `aahp-orchestrator-0.2.0.vsix` exists |
| Extension activates | assumed | `onStartupFinished` trigger |

---

## Components

| Component | Path | State | Notes |
|-----------|------|-------|-------|
| Extension entry | `src/extension.ts` | assumed | Activate/deactivate lifecycle |
| AAHP file reader | `src/aahp-reader.ts` | tested | 25 unit tests: getTopTask, buildSystemPrompt, loadAahpContext, refreshManifestChecksums, saveManifest |
| Context injector | `src/context-injector.ts` | assumed | Prepends AAHP context to AI prompts |
| Chat participant | `src/chat-participant.ts` | assumed | `@aahp` slash commands |
| Agent spawner | `src/agent-spawner.ts` | tested | 15 unit tests: scanAllRepos, pickBackend, buildAgentPrompt |
| Commands | `src/commands.ts` | assumed | VS Code command palette entries |
| Session monitor | `src/session-monitor.ts` | tested | 20 unit tests: sessions, queue, notifications |
| Sidebar | `src/sidebar.ts` | assumed | Activity bar webview panel |
| Status bar | `src/statusbar.ts` | tested | 4 unit tests: createStatusBar, updateStatusBar |
| Security (C-2/C-4/C-5) | `src/agent-spawner.ts` | tested | 8 tests: command allowlist, path traversal protection |

---

## Infrastructure

| Component | State | Notes |
|-----------|-------|-------|
| VS Code Marketplace | not published | v0.2.0 packaged as .vsix |
| GitHub Releases | not tagged | Needs `git tag v0.2.0` + release |
| CI pipeline | verified | `.github/workflows/ci.yml` - compile + lint + test on push/PR |
| Test suite | verified | Vitest, 72 tests, 5 suites, vscode mock |

---

## What is Missing

| Gap | Severity | Description |
|-----|----------|-------------|
| CI pipeline | DONE | GitHub Actions workflow added with tests |
| Automated tests | DONE | 72 unit tests via Vitest |
| VS Code Marketplace publish | MEDIUM | .vsix packaged but not published (T-003) |
| CHANGELOG.md | LOW | No changelog tracking versions |
| Integration tests | LOW | Unit tests only - no VS Code extension host tests |

---

## Recently Resolved

| Item | Resolution |
|------|-----------|
| Automated tests (T-002) | 72 Vitest unit tests across 5 suites |
| CI test step | Added `npm test` to `.github/workflows/ci.yml` |
| v0.2.0 packaging | aahp-orchestrator-0.2.0.vsix built |
| Multi-root support | `aahp.developmentRoot` config added |
| Copilot + Claude backend | `aahp.agentBackend` auto/claude/copilot setting |
| AAHP protocol structure | `.ai/handoff/` created 2026-02-27 |

---

## Trust Levels

- **(Verified)**: .vsix files exist, package.json structure correct
- **(Verified)**: CI pipeline runs compile + lint + test
- **(Verified)**: aahp-reader core logic (getTopTask, buildSystemPrompt, loadAahpContext, checksums, save)
- **(Verified)**: agent-spawner scanning, backend selection, prompt building
- **(Verified)**: session-monitor state management and queue logic
- **(Verified)**: statusbar creation and update logic
- **(Verified)**: security - command allowlist (C-2), path traversal protection (C-4/C-5)
- **(Assumed)**: chat-participant, context-injector, commands, sidebar, extension lifecycle
- **(Unknown)**: marketplace publish status
