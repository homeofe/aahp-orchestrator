# aahp-orchestrator: Next Actions for Incoming Agent

> **Auto-generated from MANIFEST.json after every agent session.**
> Priority order within each section. Work top-down. Skip blocked tasks.
> Each item is self-contained - agent can start without asking questions.

---

## Status Summary

| Status | Count | Tasks |
|--------|-------|-------|
| Done | 14 | T-001, T-002, T-004, T-005, T-006, T-007, T-008, T-009, T-010, T-011, T-012, T-013, T-014 |
| Ready | 2 | T-016, T-015 |
| Blocked | 0 | - |
| Pending | 1 | T-003 |

---

## Ready - Work These Next

### T-016: Dashboard requires manual refresh after VS Code startup
- **Priority:** high
- **GitHub:** [homeofe/aahp-orchestrator#1](https://github.com/homeofe/aahp-orchestrator/issues/1)
- **Goal:** Make the dashboard automatically refresh/initialize when VS Code starts, without requiring the user to manually invoke `AAHP: Refresh Dashboard`.
- **Context:** Every time VS Code starts, the user must press `Ctrl+Shift+P` and run `AAHP: Refresh Dashboard`. The T-014 fix (atomic batch rendering) may partially address this, but the startup auto-refresh flow should be verified and improved.
- **What to do:**
  1. Review `src/extension.ts` activation flow - `refreshAll()` is called at line 218 and via `aahp.dashboard.focus` at 500ms
  2. Test whether the T-014 batch mode fix resolves the startup rendering issue
  3. If not, investigate why the initial `refreshAll() + endBatchUpdate()` does not produce a visible render
  4. Add integration tests that verify the dashboard renders correctly on activation
- **Files:** `src/extension.ts`, `src/sidebar.ts`, `src/test/suite/extension.test.ts`
- **Definition of done:** Dashboard shows complete multi-repo data on first render after VS Code startup without user intervention. Verified by integration test.

---

### T-015: Add GitHub links to All Open Tasks tree view
- **Priority:** medium
- **GitHub:** [homeofe/aahp-orchestrator#2](https://github.com/homeofe/aahp-orchestrator/issues/2)
- **Goal:** Add inline action buttons to each task in the "All Open Tasks" tree view that open the corresponding GitHub Issues page.
- **Context:** The Dashboard webview has GitHub links (GH badges) next to repos and tasks. The All Open Tasks tree view has no GitHub links. Users need quick access to GitHub from every task.
- **What to do:**
  1. In `src/task-tree.ts`, add a `contextValue` to `FlatTask` tree items to enable inline actions
  2. In `package.json`, add a view/item/context menu contribution for `aahp.openTaskOnGitHub` command scoped to the tree view
  3. The command `aahp.openTaskOnGitHub` already exists in `src/commands.ts` - wire it to the tree view inline actions
  4. Add unit tests for the new tree item context values
- **Files:** `src/task-tree.ts`, `package.json`, `src/__tests__/task-tree.test.ts`
- **Definition of done:** Each task in the All Open Tasks tree view shows a GitHub icon button. Clicking it opens the GitHub issue page. Unit tests verify context values are set.

---

## Blocked

*(No blocked tasks)*

---

## Recently Completed

| Task | What Was Done | When |
|------|--------------|------|
| T-014: Bug: Dashboard first render incomplete + intermittent missing aahp.refreshAll command | Fixed two root causes: (1) refreshAll() now wraps all dashboard updates in nested batch mode (depth-counted beginBatchUpdate/endBatchUpdate) for atomic rendering - prevents partial UI on first render. (2) Wrapped unguarded await calls in activate() with try-catch so session cleanup failures never crash activation. Added 3 tests for batch nesting. Total: 239 tests. | 2026-03-01 |
| T-013: Test chat-participant and context-injector | Verified: T-009 already added 45 chat-participant tests and 13 context-injector tests (58 total, requirement was 20). All 234 unit tests pass. Closed as duplicate/verified. | 2026-02-28 |
| T-012: Integration tests with VS Code extension host | Expanded integration tests from 10 to 26 across 5 suites (configuration, package metadata, command execution, dashboard webview). All 26 pass in real VS Code extension host. | 2026-02-28 |
| T-011: Dashboard task filtering and sorting | New "All Tasks" section in dashboard webview with filter controls (status, priority, repo) and sorting (priority then age). Pure functions in src/task-filter.ts with 31 new tests. Total: 234 unit tests (12 suites). | 2026-02-28 |
| T-010: Integration tests with VS Code extension host | @vscode/test-electron infrastructure: runTest.ts launcher, Mocha test runner, 10 integration tests (activation, command registration, dashboard, keybindings, chat participant, views). CI updated with xvfb integration test step. | 2026-02-28 |

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
| Package config | `package.json` |
| Build config | `tsconfig.json` |
| Test config | `vitest.config.ts` |
| Unit tests | `src/__tests__/*.test.ts` |
| Integration tests | `src/test/suite/extension.test.ts` |
| Integration runner | `src/test/runTest.ts` |
| VS Code mocks | `src/__mocks__/vscode.ts` |
| Extension icon | `assets/icon.png` |
| Icon generator | `scripts/generate-icon.js` |
| Packaged .vsix | `aahp-orchestrator-0.3.0.vsix` |
| CI workflow | `.github/workflows/ci.yml` |
| Release workflow | `.github/workflows/release.yml` |
| ESLint config | `.eslintrc.json` |

---

*This file is regenerated by each agent after completing its task. It reflects the live state of MANIFEST.json.*
