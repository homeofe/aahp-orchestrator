# aahp-orchestrator: Next Actions for Incoming Agent

> **Auto-generated from MANIFEST.json after every agent session.**
> Priority order within each section. Work top-down. Skip blocked tasks.
> Each item is self-contained - agent can start without asking questions.

---

## Status Summary

| Status | Tasks |
|--------|-------|
| ✅ Done | T-001, T-002, T-004, T-005 |
| ⚡ Ready | **T-006** (task creation), **T-007** (retry logic), **T-008** (release workflow), **T-009** (test coverage), T-010 (integration tests), T-011 (filtering) |
| 🚫 Blocked | T-003 (needs VSCE_PAT from human) |

---

## ⚡ Ready - Work These Next

### T-006: Add task creation from dashboard *(medium priority)*

**Goal:** Allow creating new tasks directly from the sidebar dashboard.

**Context:**
- Currently the dashboard only supports changing task status via dropdown (`setTaskStatus` command)
- Users need to manually edit MANIFEST.json to add tasks
- Add a "New Task" button and command that prompts for title + priority

**What to do:**
1. Add `aahp.createTask` command in `commands.ts`
2. Show input boxes: task title (required), priority (quick pick: high/medium/low), depends_on (optional, comma-separated)
3. Generate next task ID from `manifest.next_task_id`, increment it
4. Write the new task to MANIFEST.json with status "ready"
5. Add "New Task" button to sidebar quick actions bar
6. Register the command in `package.json` contributes.commands
7. Reload context after creation

**Files:**
- `src/commands.ts`: add `aahp.createTask` handler
- `src/sidebar.ts`: add button to actions bar
- `package.json`: register command in contributes.commands

**Definition of done:**
- [ ] "New Task" button visible in sidebar actions
- [ ] Creates task in MANIFEST.json with correct T-xxx ID
- [ ] Increments next_task_id
- [ ] Dashboard refreshes to show new task
- [ ] Compile passes

---

### T-007: Agent retry on failure with backoff *(medium priority)*

**Goal:** Add retry capability when an agent fails.

**Context:**
- `spawnAllAgents()` in `agent-spawner.ts` sets `run.status = 'failed'` when agent exits non-zero or no commit detected
- No retry mechanism exists - failed agents just show ERR in the dashboard
- Add configurable retry (default: 1 retry) with exponential backoff

**What to do:**
1. Add `aahp.agentMaxRetries` setting in `package.json` (default: 1, min: 0, max: 3)
2. In `runSingleAgent()` inside `spawnAllAgents()`, wrap the agent execution in a retry loop
3. On failure, wait `30s * 2^attempt` before retrying
4. Update AgentRun type with `retryCount` and `maxRetries` fields
5. Show retry status in the agent card: "Retrying (1/2)..."
6. Add a manual "Retry" button in the dashboard agent cards for failed runs
7. Wire retry button to re-run via `spawnAllAgents([failedRepo], ...)`

**Files:**
- `src/agent-spawner.ts`: add retry loop in `runSingleAgent()`
- `src/sidebar.ts`: add retry button to failed agent cards
- `package.json`: add `aahp.agentMaxRetries` setting in contributes.configuration

**Definition of done:**
- [ ] Failed agents auto-retry up to configured limit
- [ ] Backoff delay between retries
- [ ] Retry count visible in dashboard
- [ ] Manual retry button for failed agents
- [ ] Tests updated

---

### T-008: GitHub release workflow (tag-triggered) *(medium priority)*

**Goal:** Automate GitHub releases on version tags.

**Context:**
- T-004 (CHANGELOG.md) is now done - this task is unblocked
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
- T-005 (aggregated all-repos view) is now done - this task is unblocked
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

## 🚫 Blocked - Cannot Start Yet

### T-003: Publish to VS Code Marketplace *(medium priority)*

**Blocked by:** Human must provide `VSCE_PAT` GitHub Actions secret.

**What to do (once unblocked):**
1. Verify local install: `code --install-extension aahp-orchestrator-0.2.0.vsix`
2. Add marketplace publish step to release workflow (T-008)
3. Run `vsce publish` or publish via workflow

**Definition of done:**
- [ ] Extension visible on VS Code Marketplace
- [ ] CHANGELOG.md exists (done - T-004)
- [ ] Version tag pushed

---

## ✅ Recently Completed

| Task | What Was Done | When |
|------|--------------|------|
| T-005: All-repos open task view | Added "All Open Tasks" tree view to sidebar, 103 tests passing | 2026-02-27 |
| T-004: CHANGELOG.md | Created CHANGELOG.md with v0.1.0 and v0.2.0 entries, vsce package passes | 2026-02-27 |
| T-002: Automated tests | 72 Vitest unit tests across 5 suites (aahp-reader, agent-spawner, session-monitor, statusbar, security) | 2026-02-27 |
| T-001: CI pipeline | `.github/workflows/ci.yml` - compile + lint + test on push/PR | 2026-02-27 |

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
| Package config | `package.json` |
| Build config | `tsconfig.json` |
| Test config | `vitest.config.ts` |
| Unit tests | `src/__tests__/*.test.ts` |
| VS Code mocks | `src/__mocks__/vscode.ts` |
| Packaged .vsix | `aahp-orchestrator-0.2.0.vsix` |
| CI workflow | `.github/workflows/ci.yml` |
| ESLint config | `.eslintrc.json` |

---

*This file is regenerated by each agent after completing its task. It reflects the live state of MANIFEST.json.*
