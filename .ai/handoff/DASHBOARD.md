# aahp-orchestrator: Build Dashboard

> Single source of truth for build health, test coverage, and pipeline state.
> Updated by agents at the end of every completed task.

---

## Components

| Name | Version | Build | Tests | Status | Notes |
|------|---------|-------|-------|--------|-------|
| Extension core | 0.2.0 | verified | - | verified | compile + activate lifecycle |
| aahp-reader | 0.2.0 | verified | 25 | verified | reads .ai/handoff/ files, checksums, manifest save |
| context-injector | 0.2.0 | verified | - | assumed | injects AAHP context to clipboard + banner |
| chat-participant | 0.2.0 | verified | - | assumed | @aahp slash commands (help/status/tasks/next/done/phase) |
| agent-spawner | 0.2.0 | verified | 15 | verified | claude/copilot launch, concurrency limiter, security |
| session-monitor | 0.2.0 | verified | 20 | verified | tracks agent state, queue, drain |
| sidebar/webview | 0.2.0 | verified | - | assumed | dashboard UI - repo grid, tasks, agent runs |
| statusbar | 0.2.0 | verified | 4 | verified | phase indicator |
| security (C-2/C-4/C-5) | 0.2.0 | verified | 8 | verified | command allowlist, path traversal protection |

**Legend:** verified - confirmed by running code/tests | assumed - from docs/config | untested - unknown

---

## Test Coverage

| Suite | Tests | Status | Last Run |
|-------|-------|--------|----------|
| unit (aahp-reader) | 25 | ✅ | 2026-02-27 |
| unit (agent-spawner) | 15 | ✅ | 2026-02-27 |
| unit (session-monitor) | 20 | ✅ | 2026-02-27 |
| unit (statusbar) | 4 | ✅ | 2026-02-27 |
| unit (security) | 8 | ✅ | 2026-02-27 |
| integration | 0 | not set up | - |
| e2e | 0 | not set up | - |

**Total: 72 tests, 72 passing (5 suites, Vitest)**

---

## Infrastructure / Deployment

| Component | Status | Blocker |
|-----------|--------|---------|
| .vsix package | verified - v0.2.0 built | - |
| VS Code Marketplace | not published | VSCE_PAT (T-003) |
| GitHub Releases | not tagged | needs CHANGELOG.md (T-004) |
| CI pipeline | ✅ verified (compile + lint + test) | - |

---

## Pipeline State

| Field | Value |
|-------|-------|
| Current task | T-004 (CHANGELOG.md) - Ready |
| Phase | implementation |
| Last completed | T-002: Add automated tests (2026-02-27) |
| Rate limit | None |

---

## Open Tasks (strategic priority)

| ID | Task | Priority | Blocked by | Ready? |
|----|------|----------|-----------|--------|
| T-004 | Add CHANGELOG.md | HIGH | - | Ready |
| T-005 | Aggregated all-repos open task view in sidebar | HIGH | - | Ready |
| T-006 | Add task creation from dashboard | MEDIUM | - | Ready |
| T-007 | Agent retry on failure with backoff | MEDIUM | - | Ready |
| T-008 | GitHub release workflow (tag-triggered) | MEDIUM | T-004 | Blocked |
| T-009 | Test chat-participant and context-injector | MEDIUM | - | Ready |
| T-010 | Integration tests with VS Code extension host | LOW | - | Ready |
| T-011 | Dashboard task filtering and sorting | LOW | T-005 | Blocked |
| T-003 | Publish to VS Code Marketplace | MEDIUM | T-004, VSCE_PAT | Blocked |

## Completed Tasks

| ID | Task | Completed |
|----|------|-----------|
| T-001 | Add GitHub Actions CI pipeline | 2026-02-27 |
| T-002 | Add automated tests (72 unit tests) | 2026-02-27 |

---

## Update Instructions (for agents)

After completing any task:

1. Update the relevant row to verified with current date
2. Update test counts
3. Update "Pipeline State"
4. Move completed task out of "Open Tasks"
5. Add newly discovered tasks with correct priority

**Pipeline rules:**
- Blocked task - skip, take next unblocked
- All tasks blocked - notify the project owner
- Notify project owner only on **fully completed tasks**, not phase transitions
- On test failures: attempt 1-2 self-fixes before escalating
