# aahp-orchestrator: Build Dashboard

> Single source of truth for build health, test coverage, and pipeline state.
> Updated by agents at the end of every completed task.
> Last updated: 2026-03-19 (T-017 refresh)

---

## Components

| Name | Version | Build | Tests | Status | Notes |
|------|---------|-------|-------|--------|-------|
| Extension core | 0.3.0 | verified | 26 (integration) | verified | compile + activate + command registration |
| aahp-reader | 0.3.0 | verified | 40 | verified | reads .ai/handoff/ files, checksums, manifest save |
| context-injector | 0.3.0 | verified | 13 | verified | injects AAHP context to clipboard + banner |
| chat-participant | 0.3.0 | verified | 45 | verified | @aahp slash commands (help/status/tasks/next/done/phase) |
| agent-spawner | 0.3.0 | verified | 15 | verified | claude/copilot launch, concurrency limiter, security |
| agent-retry | 0.3.0 | verified | 12 | verified | exponential backoff, configurable max retries |
| agent-log | 0.3.0 | verified | 16 | verified | agent run history persistence |
| session-monitor | 0.3.0 | verified | 20 | verified | tracks agent state, queue, drain |
| task-filter | 0.3.0 | verified | 31 | verified | filter/sort by status, priority, repo |
| task-tree | 0.3.0 | verified | 19 | verified | tree view, inline GitHub buttons, tooltips |
| commands (createTask) | 0.3.0 | verified | 14 | verified | createTask handler |
| commands (GitHub) | 0.3.0 | verified | 7 | verified | openTaskOnGitHub and related |
| commands (rest) | 0.3.0 | verified | 0 | assumed | ~15 handlers untested (T-019) |
| sidebar/webview | 0.3.0 | verified | 4 | assumed | link tests only; full rendering untested (T-018) |
| statusbar | 0.3.0 | verified | 4 | verified | phase indicator |
| security (C-2/C-4/C-5) | 0.3.0 | verified | 8 | verified | command allowlist, path traversal protection |

**Legend:** verified - confirmed by running code/tests | assumed - from docs/config | untested - unknown

---

## Test Coverage

| Suite | Tests | Status | Last Run |
|-------|-------|--------|----------|
| unit (aahp-reader) | 40 | OK | 2026-03-19 |
| unit (agent-spawner) | 15 | OK | 2026-03-19 |
| unit (agent-retry) | 12 | OK | 2026-03-19 |
| unit (agent-spawner-security) | 8 | OK | 2026-03-19 |
| unit (agent-log) | 16 | OK | 2026-03-19 |
| unit (session-monitor) | 20 | OK | 2026-03-19 |
| unit (statusbar) | 4 | OK | 2026-03-19 |
| unit (chat-participant) | 45 | OK | 2026-03-19 |
| unit (context-injector) | 13 | OK | 2026-03-19 |
| unit (task-filter) | 31 | OK | 2026-03-19 |
| unit (task-tree) | 19 | OK | 2026-03-19 |
| unit (commands-createTask) | 14 | OK | 2026-03-19 |
| unit (commands-github) | 7 | OK | 2026-03-19 |
| unit (sidebar-links) | 4 | OK | 2026-03-19 |
| integration (@vscode/test-electron) | 26 | OK | 2026-02-28 |

**Total: 248 unit tests (14 suites) + 26 integration tests (5 suites) = 274 tests, all passing**

---

## Infrastructure / Deployment

| Component | Status | Blocker |
|-----------|--------|---------|
| .vsix package | verified - v0.3.0 built | - |
| VS Code Marketplace | not published | VSCE_PAT (T-003) |
| GitHub Releases | workflow ready | push `v0.3.0` tag once VSCE_PAT set |
| CI pipeline | OK (compile + lint + test) | - |
| Release workflow | OK (tag-triggered) | - |

---

## Pipeline State

| Field | Value |
|-------|-------|
| Current task | T-017 (handoff docs refresh) - Done |
| Phase | implementation |
| Last completed | T-017: Refresh stale handoff documentation (2026-03-19) |
| Next ready | T-018 (sidebar tests), T-019 (commands tests), T-020 (atomic writes) |
| Rate limit | None |

---

## Open Tasks (strategic priority)

| ID | Task | Priority | Issue | Blocked by | Ready? |
|----|------|----------|-------|-----------|--------|
| T-018 | Unit tests for sidebar webview provider | MEDIUM | #8 | - | Ready |
| T-019 | Unit tests for commands module | MEDIUM | #9 | - | Ready |
| T-020 | Atomic file writes for manifest/session data | LOW | #10 | - | Ready |
| T-003 | Publish to VS Code Marketplace | PENDING | #6 | VSCE_PAT | Blocked |
| T-021 | Create project-specific CLAUDE.md | LOW | #11 | T-017 | Ready (T-017 done) |

---

## Completed Tasks

| ID | Task | Completed | Tests Added |
|----|------|-----------|-------------|
| T-017 | Refresh stale handoff documentation | 2026-03-19 | - |
| T-016 | Dashboard requires manual refresh after startup | 2026-03-01 | 3 |
| T-015 | Add GitHub links to All Open Tasks tree view | 2026-03-01 | 9 |
| T-014 | Bug: Dashboard first render incomplete | 2026-03-01 | 3 |
| T-013 | Test chat-participant and context-injector | 2026-02-28 | 58 |
| T-012 | Integration tests with VS Code extension host | 2026-02-28 | 26 |
| T-011 | Dashboard task filtering and sorting | 2026-02-28 | 31 |
| T-010 | Integration tests (alias) | 2026-02-28 | - |
| T-009 | Test chat-participant and context-injector (alias) | 2026-02-28 | - |
| T-008 | GitHub release workflow (tag-triggered) | 2026-02-28 | - |
| T-007 | Agent retry on failure with backoff | 2026-02-28 | 12 |
| T-006 | Add task creation from dashboard | 2026-02-27 | 14 |
| T-005 | Aggregated all-repos open task view in sidebar | 2026-02-27 | 4 |
| T-004 | Add CHANGELOG.md | 2026-02-27 | - |
| T-002 | Add automated tests | 2026-02-27 | 72 (initial) |
| T-001 | Add GitHub Actions CI pipeline | 2026-02-27 | - |

---

## Update Instructions (for agents)

After completing any task:

1. Update the relevant row to verified with current date
2. Update test counts
3. Update "Pipeline State"
4. Move completed task from "Open Tasks" to "Completed Tasks"
5. Add newly discovered tasks with correct priority

**Pipeline rules:**
- Blocked task - skip, take next unblocked
- All tasks blocked - notify the project owner
- Notify project owner only on **fully completed tasks**, not phase transitions
- On test failures: attempt 1-2 self-fixes before escalating
