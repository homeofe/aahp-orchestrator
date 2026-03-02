# NEXT_ACTIONS - aahp-orchestrator

> **Auto-generated task roadmap.**
> Priority order within each section. Work top-down. Skip blocked tasks.
> Each item is self-contained - agent can start without asking questions.

---

## Status Summary

| Status | Count | Tasks |
|--------|-------|-------|
| Done | 16 | T-001, T-002, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013, T-014, T-015, T-016 |
| Ready | 4 | T-017, T-018, T-019, T-020 |
| Blocked | 0 | - |
| Pending | 2 | T-003, T-021 |

---

## Ready - Work These Next

### T-017: Refresh stale handoff documentation [high] (issue #7)

- **Goal:** Bring STATUS.md, TRUST.md, and DASHBOARD.md in sync with the actual project state (v0.3.0, 248 unit tests, 26 integration tests).
- **Context:** These files were last updated at v0.2.0 with 72 tests. Since then, 8 tasks were completed, test count tripled, integration tests were added, batch rendering was implemented, and GitHub issue sync was built. Incoming agents that read these files get a misleading picture of the project - e.g., chat-participant and context-injector are listed as "assumed" in TRUST.md despite having 58 verified tests.
- **What to do:**
  1. Rewrite `STATUS.md`: update version to 0.3.0, test counts to 248 unit + 26 integration (14 + 5 suites), build health checks, component states. Mark chat-participant, context-injector as "tested". List the 53 ESLint warnings as a known item.
  2. Rewrite `TRUST.md`: promote chat-participant (45 tests), context-injector (13 tests), agent-retry (12 tests), task-filter (31 tests), task-tree (19 tests), commands-createTask (14 tests), commands-github (7 tests), sidebar-links (4 tests) from "assumed" to "verified". Sidebar webview rendering and commands module remain "assumed".
  3. Rewrite `DASHBOARD.md`: update component table with current test counts across all 14 suites. Update open task count and gap list.
  4. Update file summaries in MANIFEST.json to match new content.
- **Files:** `.ai/handoff/STATUS.md`, `.ai/handoff/TRUST.md`, `.ai/handoff/DASHBOARD.md`, `.ai/handoff/MANIFEST.json`
- **Definition of Done:**
  - [ ] STATUS.md reflects v0.3.0, 248+26 tests, current component states
  - [ ] TRUST.md has correct verified/assumed classifications
  - [ ] DASHBOARD.md matches current test suites and open task count
  - [ ] MANIFEST.json file summaries updated

### T-018: Unit tests for sidebar webview provider [medium] (issue #8)

- **Goal:** Add unit tests for the largest untested source file - `sidebar.ts` (1567 lines, currently only 4 link-related tests in sidebar-links.test.ts).
- **Context:** The sidebar webview provider handles HTML rendering, message passing, batch update logic, filter state, collapsible sections, dashboard data binding, and cron run display. It is marked "assumed" in TRUST.md. The dashboard is the primary UI surface of the extension, making this the biggest test coverage gap.
- **What to do:**
  1. Create `src/__tests__/sidebar.test.ts`
  2. Mock `vscode.WebviewView` and the webview message API
  3. Test `resolveWebviewView` - verify CSP headers, HTML structure, resource URIs
  4. Test message handling: `setPhase`, `setTaskStatus`, `launchTask`, `openGitHub`, `filterTasks`, `toggleSection`, etc.
  5. Test `beginBatchUpdate()` / `endBatchUpdate()` nesting (depth counting, pending render flag)
  6. Test `updateContext()`, `updateOverviews()`, `updateAgentRuns()` - verify they trigger renders outside batch mode and defer inside batch mode
  7. Test filter state persistence and `_applyFilter()` logic
  8. Test debounce behavior (50ms render coalescing)
  9. Target: 30+ tests covering rendering, messaging, batch mode, and state management
- **Files:** `src/sidebar.ts`, `src/__tests__/sidebar.test.ts`, `src/__mocks__/vscode.ts`
- **Definition of Done:**
  - [ ] sidebar.test.ts exists with 30+ passing tests
  - [ ] Batch update nesting and debounce behavior covered
  - [ ] Message handlers for all webview commands covered
  - [ ] HTML generation produces valid structure with CSP nonce
  - [ ] Sidebar promoted from "assumed" to "verified" in TRUST.md

### T-019: Unit tests for commands module [medium] (issue #9)

- **Goal:** Add unit tests for untested command handlers in `commands.ts` (956 lines, only 21 tests cover createTask and GitHub commands).
- **Context:** The commands module registers 21 VS Code commands. Only `createTask` (14 tests) and GitHub-related commands (7 tests) are tested. The remaining ~15 handlers - including `setPhase`, `setTaskStatus`, `setTaskPriority`, `launchTask`, `runAll`, `runSingleRepo`, `markTaskDone`, `fixTask`, `commitSession`, `copyContext`, `openAgentHistory`, `cancelAgent`, `focusRepo`, `retryAgent` - have no unit tests. This module is marked "assumed" in TRUST.md.
- **What to do:**
  1. Create `src/__tests__/commands.test.ts`
  2. Mock dependencies: vscode API (showQuickPick, showInputBox, window), aahp-reader, agent-spawner, session-monitor, sidebar provider
  3. Test phase commands: `setPhase` shows quickpick with 6 phases, updates manifest, refreshes dashboard
  4. Test task status commands: `setTaskStatus` / `setTaskPriority` update correct fields in manifest
  5. Test agent commands: `launchTask` spawns agent for selected task, `runAll` triggers parallel execution, `cancelAgent` sends kill signal
  6. Test `markTaskDone` / `fixTask` - status transitions and manifest persistence
  7. Test `commitSession` - manifest checksums refreshed, session data saved
  8. Test `copyContext` delegates to context-injector
  9. Target: 25+ tests
- **Files:** `src/commands.ts`, `src/__tests__/commands.test.ts`, `src/__mocks__/vscode.ts`
- **Definition of Done:**
  - [ ] commands.test.ts exists with 25+ passing tests
  - [ ] All command handlers that mutate manifest state are tested
  - [ ] Agent spawn/cancel commands are tested
  - [ ] Commands module promoted from "assumed" to "verified" in TRUST.md

### T-020: Atomic file writes for manifest and session data [low] (issue #10)

- **Goal:** Prevent data corruption by using write-to-temp-then-rename for MANIFEST.json and sessions.json writes.
- **Context:** `saveManifest()` in aahp-reader.ts and session writes in session-monitor.ts use `fs.promises.writeFile()` directly. If the process crashes mid-write or the file is on a network-mapped drive (e.g., Nextcloud, SMB), the file can be left truncated or empty. This is a real risk in the project's own development environment (Nextcloud-synced directory). The fix is a standard pattern: write to a `.tmp` file in the same directory, then `fs.promises.rename()` which is atomic on most filesystems.
- **What to do:**
  1. Add a `writeFileAtomic(filePath, data)` utility function (write to `${filePath}.tmp`, then rename)
  2. Replace `fs.promises.writeFile` calls in `saveManifest()` (aahp-reader.ts) with `writeFileAtomic`
  3. Replace `fs.promises.writeFile` calls in session-monitor.ts with `writeFileAtomic`
  4. Add unit tests for the atomic write utility (normal write, temp cleanup on error)
  5. Verify existing tests still pass
- **Files:** `src/aahp-reader.ts`, `src/session-monitor.ts`, `src/__tests__/aahp-reader.test.ts`, `src/__tests__/session-monitor.test.ts`
- **Definition of Done:**
  - [ ] All manifest and session file writes use atomic write pattern
  - [ ] Temp files cleaned up on write failure
  - [ ] Existing tests pass without modification
  - [ ] New tests verify atomic write behavior

---

## Blocked

*(No blocked tasks)*

---

## Pending

### T-003: Publish to VS Code Marketplace [medium] (issue #6)
- **GitHub:** [homeofe/aahp-orchestrator#6](https://github.com/homeofe/aahp-orchestrator/issues/6)
- **Blocked on:** VSCE_PAT secret from project owner. Extension is packaged and ready (v0.3.0.vsix). Run `npm run publish` or push a `v0.3.0` tag once PAT is configured.

### T-021: Create project-specific CLAUDE.md [low] (issue #11)
- **Goal:** Add a CLAUDE.md to the project root with project-specific conventions, commands, and architecture notes.
- **Context:** No project-level CLAUDE.md exists. Agents rely on the workspace-level `_Development/CLAUDE.md` which lacks aahp-orchestrator-specific information like build commands (`npm run compile`, `npm test`, `npm run lint`), architecture (webview provider pattern, batch rendering, multi-repo scanning), test conventions (Vitest for unit, @vscode/test-electron for integration), and the AAHP handoff protocol structure. A project CLAUDE.md would reduce cold-start time for incoming agents.
- **Depends on:** T-017 (handoff docs should be accurate first)

---

## Recently Completed

| Task | What Was Done | When |
|------|--------------|------|
| T-016: Dashboard requires manual refresh after VS Code startup | Verified the T-014 batch rendering fix resolves startup auto-refresh. Dashboard now renders complete multi-repo data on first activation without manual intervention. | 2026-03-01 |
| T-015: Add GitHub links to All Open Tasks tree view | Inline GitHub icon button (`$(github)`) on each task in the All Open Tasks tree view. Opens direct issue URL when `github_issue` is linked, falls back to GitHub Issues search. Enhanced tooltip shows GitHub issue number. 7 new tests in commands-github.test.ts, 2 tooltip tests in task-tree.test.ts. Total: 248 tests (14 suites). | 2026-03-01 |
| T-014: Bug: Dashboard first render incomplete | Fixed two root causes: (1) refreshAll() wraps all dashboard updates in nested batch mode for atomic rendering. (2) Wrapped unguarded await calls in activate() with try-catch. Added 3 tests for batch nesting. | 2026-03-01 |
| T-013: Test chat-participant and context-injector | Verified: 45 chat-participant tests + 13 context-injector tests (58 total). Closed as duplicate/verified. | 2026-02-28 |
| T-012: Integration tests with VS Code extension host | 26 integration tests across 5 suites (configuration, package metadata, command execution, dashboard webview). | 2026-02-28 |

---

## Reference: Key File Locations

| What | Where |
|------|-------|
| Extension entry | `src/extension.ts` |
| AAHP file reader | `src/aahp-reader.ts` |
| Context injector | `src/context-injector.ts` |
| Chat participant | `src/chat-participant.ts` |
| Agent spawner | `src/agent-spawner.ts` |
| Session monitor | `src/session-monitor.ts` |
| Sidebar dashboard | `src/sidebar.ts` |
| Task filter/sort | `src/task-filter.ts` |
| Status bar | `src/statusbar.ts` |
| Commands | `src/commands.ts` |
| Task tree view | `src/task-tree.ts` |
| Agent log store | `src/agent-log.ts` |
| Package config | `package.json` |
| Build config | `tsconfig.json` |
| Test config | `vitest.config.ts` |
| Unit tests | `src/__tests__/*.test.ts` (14 suites, 248 tests) |
| Integration tests | `src/test/suite/extension.test.ts` (5 suites, 26 tests) |
| Integration runner | `src/test/runTest.ts` |
| VS Code mocks | `src/__mocks__/vscode.ts` |
| Extension icon | `assets/icon.png` |
| Packaged .vsix | `aahp-orchestrator-0.3.0.vsix` |
| CI workflow | `.github/workflows/ci.yml` |
| Release workflow | `.github/workflows/release.yml` |
| ESLint config | `.eslintrc.json` |

---

*This file is regenerated by each agent after completing its task. It reflects the live state of MANIFEST.json.*
