# aahp-orchestrator: Current State of the Nation

> Last updated: 2026-03-19 by Claude Code (T-017)
> Version: 0.3.0
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
> It reflects the *current* reality, not history. History lives in LOG.md.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `npm run compile` | verified | TypeScript to `out/`, 0 errors |
| `npm run lint` | verified | ESLint passes (0 errors, 53 warnings) |
| `npm test` | verified | 248 tests pass (14 suites, Vitest) |
| Integration tests | verified | 26 tests across 5 suites (@vscode/test-electron) |
| `vsce package` | verified | `aahp-orchestrator-0.3.0.vsix` exists |
| Extension activates | verified | Integration tests confirm activation and command registration |

---

## Components

| Component | Path | State | Tests | Notes |
|-----------|------|-------|-------|-------|
| Extension entry | `src/extension.ts` | verified | 26 (integration) | Activate/deactivate lifecycle; integration tests confirm activation |
| AAHP file reader | `src/aahp-reader.ts` | verified | 40 | getTopTask, buildSystemPrompt, loadAahpContext, refreshManifestChecksums, saveManifest |
| Context injector | `src/context-injector.ts` | verified | 13 | Clipboard copy + one-time banner; unit tests added in T-013 |
| Chat participant | `src/chat-participant.ts` | verified | 45 | @aahp slash commands (help/status/tasks/next/done/phase); unit tests added in T-013 |
| Agent spawner | `src/agent-spawner.ts` | verified | 15 | claude/copilot launch, concurrency limiter, security |
| Agent retry | `src/agent-spawner.ts` | verified | 12 | Exponential backoff, configurable max retries |
| Agent log | `src/agent-log.ts` | verified | 16 | Agent run history persistence |
| Commands | `src/commands.ts` | assumed | 21 | createTask (14 tests) + GitHub (7 tests); ~15 handlers untested (T-019) |
| Session monitor | `src/session-monitor.ts` | verified | 20 | Sessions, queue, notifications |
| Sidebar webview | `src/sidebar.ts` | assumed | 4 | 4 link tests only; full webview rendering untested (T-018) |
| Status bar | `src/statusbar.ts` | verified | 4 | createStatusBar, updateStatusBar |
| Task filter | `src/task-filter.ts` | verified | 31 | Filter/sort by status, priority, repo |
| Task tree | `src/task-tree.ts` | verified | 19 | Tree view items, inline GitHub buttons, tooltips |
| Security (C-2/C-4/C-5) | `src/agent-spawner.ts` | verified | 8 | Command allowlist, path traversal protection |

---

## Infrastructure

| Component | State | Notes |
|-----------|-------|-------|
| VS Code Marketplace | not published | v0.3.0 packaged as .vsix; blocked on VSCE_PAT (T-003) |
| GitHub Releases | workflow ready | Tag-triggered release.yml; push `v0.3.0` tag once VSCE_PAT is set |
| CI pipeline | verified | `.github/workflows/ci.yml` - compile + lint + test on push/PR |
| Release workflow | verified | `.github/workflows/release.yml` - tag-triggered .vsix + GitHub Release |
| Test suite (unit) | verified | Vitest, 248 tests, 14 suites, vscode mock |
| Test suite (integration) | verified | @vscode/test-electron, 26 tests, 5 suites |

---

## Open Tasks

| Gap | Severity | Task | Description |
|-----|----------|------|-------------|
| Sidebar unit tests | MEDIUM | T-018 | `sidebar.ts` is 1567 lines; only 4 link tests; full webview rendering unverified |
| Commands unit tests | MEDIUM | T-019 | ~15 command handlers have no unit tests |
| Atomic file writes | LOW | T-020 | Use write-temp-then-rename to prevent data corruption on crashes/network drives |
| VS Code Marketplace | PENDING | T-003 | .vsix ready; blocked on human providing VSCE_PAT secret |
| CLAUDE.md | BLOCKED | T-021 | Project-specific CLAUDE.md; depends on T-017 (this task) being done first |

---

## Recently Completed

| Item | Task | Resolution |
|------|------|-----------|
| GitHub links in task tree view | T-015 | Inline `$(github)` icon per task; opens issue URL or search |
| Dashboard startup bug | T-014, T-016 | Batch rendering wraps all updates atomically; try-catch on activate(); auto-refresh on startup |
| Integration tests | T-012 | 26 tests across 5 suites via @vscode/test-electron |
| Chat/injector tests | T-013 | 45 chat-participant + 13 context-injector = 58 new tests |
| Task filtering/sorting | T-011 | Filter by status/priority/repo; sort by priority then age |
| Dashboard task view | T-005 | Aggregated all-repos open task view in sidebar |
| Task creation | T-006 | Create tasks from dashboard |
| Agent retry | T-007 | Exponential backoff, configurable max retries |
| GitHub release workflow | T-008 | Tag-triggered CI/CD with .vsix artifact |
| Test suite | T-002 | Grew from 72 to 248 tests across 14 suites |
| CHANGELOG.md | T-004 | Keep a Changelog format |
| CI pipeline | T-001 | compile + lint + test on push/PR |

---

## Known Issues / Tech Debt

- **ESLint:** 53 warnings (mostly `no-explicit-any`, `no-unused-vars`) - non-blocking, tracked
- **Sidebar:** `sidebar.ts` at 1567 lines is untested beyond 4 link assertions (T-018)
- **Commands:** ~15 of 21 registered command handlers lack unit tests (T-019)
- **Marketplace:** Requires VSCE_PAT secret from project owner to publish

---

## Trust Levels

- **(Verified):** npm compile, lint, test (248 unit + 26 integration)
- **(Verified):** aahp-reader, agent-spawner, agent-retry, agent-log, session-monitor, statusbar, task-filter, task-tree, security
- **(Verified):** chat-participant (45 tests), context-injector (13 tests)
- **(Verified):** Extension activation and command registration (integration tests)
- **(Assumed):** sidebar webview rendering (beyond 4 link tests), most commands handlers, extension lifecycle deactivation
- **(Unknown):** VS Code Marketplace publish status
