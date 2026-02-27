# aahp-orchestrator: Build Dashboard

> Single source of truth for build health, test coverage, and pipeline state.
> Updated by agents at the end of every completed task.

---

## Components

| Name | Version | Build | Tests | Status | Notes |
|------|---------|-------|-------|--------|-------|
| Extension core | 0.2.0 | assumed | - | assumed | compile + activate |
| aahp-reader | 0.2.0 | assumed | - | assumed | reads .ai/handoff/ files |
| context-injector | 0.2.0 | assumed | - | assumed | injects context to AI |
| chat-participant | 0.2.0 | assumed | - | assumed | @aahp slash commands |
| agent-spawner | 0.2.0 | assumed | - | assumed | claude/copilot launch |
| session-monitor | 0.2.0 | assumed | - | assumed | tracks agent state |
| sidebar/webview | 0.2.0 | assumed | - | assumed | dashboard UI |
| statusbar | 0.2.0 | assumed | - | assumed | phase indicator |

**Legend:** verified - confirmed by running code | assumed - from docs/config | untested - unknown

---

## Test Coverage

| Suite | Tests | Status | Last Run |
|-------|-------|--------|----------|
| unit | 72 | ✅ All passing | 2026-02-27 |
| integration | 0 | not set up | - |
| e2e | 0 | not set up | - |

---

## Infrastructure / Deployment

| Component | Status | Blocker |
|-----------|--------|---------|
| .vsix package | verified - v0.2.0 built | - |
| VS Code Marketplace | not published | VSCE_PAT |
| GitHub Releases | not tagged | - |
| CI pipeline | ✅ set up (T-001 done) | - |

---

## Pipeline State

| Field | Value |
|-------|-------|
| Current task | T-003 (Marketplace publish) - Blocked |
| Phase | implementation |
| Last completed | T-002: Add automated tests (2026-02-27) |
| Rate limit | None |

---

## Open Tasks (strategic priority)

| ID | Task | Priority | Blocked by | Ready? |
|----|------|----------|-----------|--------|
| T-003 | Publish to VS Code Marketplace | MEDIUM | VSCE_PAT | Blocked |

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
