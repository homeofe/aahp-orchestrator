# aahp-orchestrator: Next Actions for Incoming Agent

> **Auto-generated from MANIFEST.json after every agent session.**
> Priority order within each section. Work top-down. Skip blocked tasks.
> Each item is self-contained - agent can start without asking questions.

---

## Status Summary

| Status | Count | Tasks |
|--------|-------|-------|
| Done | 8 | T-001, T-002, T-003, T-004, T-005, T-006, T-007 |
| Ready | 4 | T-008, T-009, T-010, T-011 |
| Blocked | 0 | - |

---

## Ready - Work These Next

### T-008: GitHub release workflow (tag-triggered) *(medium priority)*

**Goal:** Automate GitHub releases on version tags.

**Context:**
- T-004 (CHANGELOG.md) is done - this task is unblocked
- T-003 (Marketplace readiness) is done - publish script exists
- Publish .vsix as a GitHub Release asset when `git tag v*` is pushed

**What to do:**
1. Create `.github/workflows/release.yml`
2. Trigger on `push` tags matching `v*`
3. Steps: checkout, `npm ci`, compile, lint, test, `vsce package`
4. Create GitHub Release with .vsix as asset
5. Extract release notes from CHANGELOG.md for the tagged version
6. Optionally add `vsce publish` step gated behind `VSCE_PAT` secret

**Files:**
- `.github/workflows/release.yml`: create

**Definition of done:**
- [ ] Workflow triggers on `git tag v*`
- [ ] Builds and attaches .vsix to GitHub Release
- [ ] CHANGELOG excerpt included in release notes

---

### T-009: Test chat-participant and context-injector *(medium priority)*

**Goal:** Add unit tests for the two untested modules.

**Context:**
- `chat-participant.ts` has 7 slash command handlers - each is a pure function taking a stream + context
- `context-injector.ts` registers a clipboard copy command and shows a one-time banner
- Both are currently "assumed" in trust state

**What to do:**
1. Create `src/__tests__/chat-participant.test.ts`
2. Export handler functions from `chat-participant.ts` (or test through the participant)
3. Mock `vscode.ChatResponseStream` as `{ markdown: vi.fn() }`
4. Test each handler: handleHelp, handleStatus, handleTasks, handleNext, handleDone, handlePhase
5. Create `src/__tests__/context-injector.test.ts`
6. Test clipboard copy command and banner trigger behavior
7. Update DASHBOARD.md and TRUST.md to mark both as verified

**Files:**
- `src/__tests__/chat-participant.test.ts`: create
- `src/__tests__/context-injector.test.ts`: create
- `src/chat-participant.ts`: export handler functions for testing

**Definition of done:**
- [ ] At least 15 tests for chat-participant handlers
- [ ] At least 5 tests for context-injector
- [ ] All tests pass (old + new)
- [ ] CI passes

---

### T-010: Integration tests with VS Code extension host *(low priority)*

**Goal:** Set up real VS Code extension host tests.

**Context:**
- Current tests are pure unit tests with mocked VS Code API
- Integration tests verify the extension actually activates, registers commands, and renders webviews
- Uses `@vscode/test-electron` (officially recommended by VS Code team)

**What to do:**
1. Install `@vscode/test-electron` as dev dependency
2. Create `src/test/suite/` directory with integration test files
3. Create `src/test/suite/index.ts` - Mocha test runner entry
4. Create `src/test/runTest.ts` - launches VS Code with the extension and test suite
5. Test: extension activation, command registration, manifest loading from a fixture `.ai/handoff/` directory
6. Add `test:integration` script to `package.json`

**Files:**
- `src/test/suite/extension.test.ts`: create
- `src/test/suite/index.ts`: test runner entry
- `src/test/runTest.ts`: launch script
- `package.json`: add `test:integration` script

**Definition of done:**
- [ ] At least 5 integration tests
- [ ] Tests pass locally
- [ ] Test script in package.json

---

### T-011: Dashboard task filtering and sorting *(low priority)*

**Goal:** Add filter controls to the aggregated task view.

**Context:**
- T-005 (aggregated all-repos view) is done - this task is unblocked
- The "All Open Tasks" section exists in sidebar but has no filters

**What to do:**
1. Add filter dropdown/chips above the all-tasks table: by status, by priority, by repo
2. Use webview message passing to persist filter state
3. Apply filters to the rendered task list
4. Add sort options: by priority (default), by age, by repo name

**Files:**
- `src/sidebar.ts`: add filter controls to all-open-tasks section

**Definition of done:**
- [ ] Filter by status works
- [ ] Filter by priority works
- [ ] Filter by repo works
- [ ] Filters persist within session

---

## Blocked

*(No blocked tasks)*

---

## Recently Completed

| Task | What Was Done | When |
|------|--------------|------|
| T-003: Publish to VS Code Marketplace | Extension icon, gallery metadata, publish script, .vscodeignore cleanup, CHANGELOG v0.3.0. Ready to publish with VSCE_PAT. | 2026-02-28 |
| T-007: Agent retry on failure | Retry loop with exponential backoff (30s * 2^n), configurable max retries, dashboard retry button, 12 new tests (129 total) | 2026-02-28 |
| T-006: Task creation from dashboard | "New Task" button + aahp.createTask command, prompts for title/priority/deps, writes to MANIFEST.json | 2026-02-27 |
| T-005: All-repos open task view | Added "All Open Tasks" tree view to sidebar, 103 tests passing | 2026-02-27 |
| T-004: CHANGELOG.md | Created CHANGELOG.md with v0.1.0 and v0.2.0 entries, vsce package passes | 2026-02-27 |

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
| Status bar | `src/statusbar.ts` |
| Commands | `src/commands.ts` |
| Task tree view | `src/task-tree.ts` |
| Package config | `package.json` |
| Build config | `tsconfig.json` |
| Test config | `vitest.config.ts` |
| Unit tests | `src/__tests__/*.test.ts` |
| VS Code mocks | `src/__mocks__/vscode.ts` |
| Extension icon | `assets/icon.png` |
| Icon generator | `scripts/generate-icon.js` |
| Packaged .vsix | `aahp-orchestrator-0.3.0.vsix` |
| CI workflow | `.github/workflows/ci.yml` |
| ESLint config | `.eslintrc.json` |

---

*This file is regenerated by each agent after completing its task. It reflects the live state of MANIFEST.json.*
