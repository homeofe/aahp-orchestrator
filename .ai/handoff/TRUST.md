# aahp-orchestrator: Trust Register

> Tracks verification status of critical system properties.
> In multi-agent pipelines, hallucinations and drift are real risks.
> Every claim here has a confidence level tied to how it was verified.
> Last updated: 2026-03-19 (T-017 refresh)

---

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **verified** | An agent executed code, ran tests, or observed output to confirm this |
| **assumed** | Derived from docs, config files, or chat, not directly tested |
| **untested** | Status unknown; needs verification |

---

## Build System

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `npm run compile` passes | verified | 2026-03-19 | Claude Code | 0 TypeScript errors |
| `npm run lint` passes | verified | 2026-03-19 | Claude Code | 0 errors, 53 warnings |
| `npm test` passes (248 unit) | verified | 2026-03-19 | Claude Code | 14 suites, all green |
| Integration tests pass (26) | verified | 2026-03-19 | Claude Code | 5 suites via @vscode/test-electron |
| `vsce package` produces valid .vsix | verified | 2026-02-28 | Claude Code | aahp-orchestrator-0.3.0.vsix |
| Extension activates in VS Code | verified | 2026-02-28 | Claude Code | Integration suite confirms activation |

---

## Components

| Component | Status | Tests | Last Verified | Notes |
|-----------|--------|-------|---------------|-------|
| aahp-reader | **verified** | 40 | 2026-03-19 | Core read/write/checksum logic |
| agent-spawner | **verified** | 15 | 2026-03-19 | claude/copilot dispatch, concurrency |
| agent-retry | **verified** | 12 | 2026-03-19 | Exponential backoff in agent-spawner.ts |
| agent-log | **verified** | 16 | 2026-03-19 | Agent run history store |
| session-monitor | **verified** | 20 | 2026-03-19 | Session lifecycle, queue, drain |
| statusbar | **verified** | 4 | 2026-03-19 | Phase indicator |
| security (C-2/C-4/C-5) | **verified** | 8 | 2026-03-19 | Command allowlist, path traversal |
| chat-participant | **verified** | 45 | 2026-03-19 | All 7 slash command handlers unit tested |
| context-injector | **verified** | 13 | 2026-03-19 | Clipboard copy + banner unit tested |
| task-filter | **verified** | 31 | 2026-03-19 | Filter/sort by status/priority/repo |
| task-tree | **verified** | 19 | 2026-03-19 | Tree items, GitHub inline buttons, tooltips |
| commands (createTask) | **verified** | 14 | 2026-03-19 | createTask handler tested |
| commands (GitHub) | **verified** | 7 | 2026-03-19 | openTaskOnGitHub and related |
| commands (rest) | **assumed** | 0 | - | ~15 handlers untested (T-019) |
| sidebar webview | **assumed** | 4 | 2026-03-19 | Only 4 link tests; full rendering untested (T-018) |
| extension lifecycle | **verified** | 26 (integration) | 2026-02-28 | Activation + command registration confirmed |

---

## Extension Functionality

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `@aahp /status` responds | verified | 2026-02-28 | Claude Code | chat-participant unit tests |
| `@aahp /tasks` lists tasks | verified | 2026-02-28 | Claude Code | chat-participant unit tests |
| `@aahp /next` recommends task | verified | 2026-02-28 | Claude Code | chat-participant unit tests |
| `@aahp /done` marks task done | verified | 2026-02-28 | Claude Code | chat-participant unit tests |
| `@aahp /phase` shows/sets phase | verified | 2026-02-28 | Claude Code | chat-participant unit tests |
| Context injected to clipboard | verified | 2026-02-28 | Claude Code | context-injector unit tests |
| Sidebar webview loads | verified | 2026-02-28 | Claude Code | Integration test confirms rendering |
| Status bar shows phase | verified | 2026-02-28 | Claude Code | statusbar unit tests |
| Multi-root scan works | verified | 2026-02-28 | Claude Code | agent-spawner unit tests |
| Agent spawner launches Claude | verified | 2026-02-28 | Claude Code | agent-spawner unit tests |
| Agent spawner launches Copilot | verified | 2026-02-28 | Claude Code | agent-spawner unit tests |
| Agent retry on failure | verified | 2026-02-28 | Claude Code | agent-retry unit tests (12 tests) |
| Task filtering/sorting | verified | 2026-03-01 | Claude Code | task-filter unit tests (31 tests) |
| GitHub links in tree view | verified | 2026-03-01 | Claude Code | commands-github + task-tree tests |
| Dashboard auto-refresh on startup | verified | 2026-03-01 | Claude Code | T-016 fix + integration tests |

---

## Configuration

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| `aahp.developmentRoot` setting exists | verified | 2026-02-27 | Copilot | In package.json contributes.configuration |
| `aahp.agentBackend` setting exists | verified | 2026-02-27 | Copilot | auto/claude/copilot options |
| `aahp.agentConcurrencyLimit` exists | verified | 2026-02-27 | Copilot | In package.json |
| `aahp.agentMaxRetries` exists | verified | 2026-02-28 | Claude Code | Added with T-007, 0-5 range |
| `aahp.suppressRootPrompt` exists | verified | 2026-02-28 | Claude Code | Suppress startup prompt |

---

## Security

| Property | Status | Last Verified | Agent | Notes |
|----------|--------|---------------|-------|-------|
| No secrets in source | assumed | - | - | .aiignore patterns enforced |
| Webview CSP configured | verified | 2026-02-28 | Claude Code | Integration test checks CSP headers |
| No external network calls in extension | assumed | - | - | Extension is local-only by design |
| .aiignore blocks PII from handoff reads | assumed | - | - | Pattern file exists |
| Command allowlist enforced | verified | 2026-02-28 | Claude Code | 8 security tests for C-2/C-4/C-5 |
| Path traversal protection | verified | 2026-02-28 | Claude Code | agent-spawner-security tests |

---

## Update Rules (for agents)

- Change `untested` to `verified` only after **running actual code/tests**
- Change `assumed` to `verified` after direct confirmation
- Never downgrade `verified` without explaining why in `LOG.md`
- Add new rows when new system properties become critical

---

*Trust degrades over time. Re-verify periodically, especially after major refactors.*
