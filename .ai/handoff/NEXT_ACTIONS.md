# aahp-orchestrator: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item must be self-contained - the agent must be able to start without asking questions.
> Blocked tasks go to the bottom.

---

## T-004: Add CHANGELOG.md

**Goal:** Create CHANGELOG.md documenting v0.1.0 and v0.2.0 releases.

**Context:**
- Required by VS Code Marketplace (vsce publish rejects without it)
- Blocks T-003 (Marketplace publish) and T-008 (GitHub release workflow)
- Follow [Keep a Changelog](https://keepachangelog.com/) format

**What to do:**
1. Create `CHANGELOG.md` at repo root
2. Document v0.1.0: initial release with core features (aahp-reader, context-injector, chat-participant, sidebar, statusbar)
3. Document v0.2.0: agent-spawner, session-monitor, multi-repo support, 72 unit tests, CI pipeline, security hardening (C-2/C-4/C-5), concurrency limiter
4. Add `Unreleased` section for upcoming changes

**Files:**
- `CHANGELOG.md`: create at repo root

**Definition of done:**
- [ ] CHANGELOG.md exists with v0.1.0 and v0.2.0 entries
- [ ] Follows Keep a Changelog format
- [ ] `vsce package` still succeeds

---

## T-005: Aggregated all-repos open task view in sidebar

**Goal:** Add a unified "All Open Tasks" section to the sidebar dashboard that shows open tasks across all scanned repos.

**Context:**
- The sidebar already shows a repo grid (cards per repo) and a focused project view with task table
- Missing: a single aggregated list of ALL open tasks across ALL repos, sorted by priority
- The `scanAllRepoOverviews()` function in `aahp-reader.ts` already scans all repos and returns task counts
- Each `RepoOverview` already contains `manifest.tasks` - no extra I/O needed
- The sidebar needs a new section between the repo grid and focused project sections

**What to do:**
1. In `sidebar.ts`, add a new `_renderAllOpenTasks()` method
2. Iterate `_repoOverviews`, for each repo load its manifest tasks from `RepoOverview.manifest.tasks`
3. Collect all tasks where `status !== 'done'` across all repos
4. Sort: in_progress first, then ready, then blocked, then pending; within each group sort by priority (high > medium > low)
5. Render as a table: `[repo] [task-id] [title] [priority] [status]`
6. Add collapsible section header "All Open Tasks (N)"
7. Wire up the section toggle using existing `_collapsedSections` logic
8. Call `_renderAllOpenTasks()` from `_getHtml()` between repo grid and focused project

**Files:**
- `src/sidebar.ts`: add `_renderAllOpenTasks()`, call from `_getHtml()`

**Definition of done:**
- [ ] New "All Open Tasks" section visible in sidebar
- [ ] Shows tasks from all scanned repos with repo name prefix
- [ ] Sorted by status then priority
- [ ] Collapsible
- [ ] Compile passes

---

## T-006: Add task creation from dashboard

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

## T-007: Agent retry on failure with backoff

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

## T-009: Test chat-participant and context-injector

**Goal:** Add unit tests for the two untested modules to move them from "assumed" to "verified".

**Context:**
- `chat-participant.ts` has 7 slash command handlers - each is a pure function taking a stream + context
- The handlers are module-private, so either export them or test via `registerChatParticipant`
- `context-injector.ts` registers a clipboard copy command and shows a one-time banner
- Both are currently "assumed" in trust state

**What to do:**
1. Create `src/__tests__/chat-participant.test.ts`
2. Export handler functions from `chat-participant.ts` (or test through the participant)
3. Mock `vscode.ChatResponseStream` as `{ markdown: vi.fn() }`
4. Test each handler: handleHelp (returns help text), handleStatus (formats manifest), handleTasks (lists all), handleNext (picks next ready), handleDone (marks done + saves), handlePhase (validates + saves)
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

## T-010: Integration tests with VS Code extension host

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
5. Test: extension activation, command registration (`aahp.updateManifest` etc.), manifest loading from a fixture `.ai/handoff/` directory
6. Add `test:integration` script to `package.json`
7. Optionally add to CI (requires xvfb on Linux)

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

## T-008: GitHub release workflow (tag-triggered) *** Blocked ***

**Goal:** Automate GitHub releases on version tags.

**Blocked by:** T-004 (CHANGELOG.md)

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

## T-011: Dashboard task filtering and sorting *** Blocked ***

**Goal:** Add filter controls to the aggregated task view.

**Blocked by:** T-005 (aggregated task view must exist first)

**What to do:**
1. Add filter dropdown/chips above the all-tasks table: by status, by priority, by repo
2. Use webview message passing to persist filter state
3. Apply filters to the rendered task list
4. Add sort options: by priority (default), by age, by repo name

**Definition of done:**
- [ ] Filter by status works
- [ ] Filter by priority works
- [ ] Filter by repo works
- [ ] Filters persist within session

---

## T-003: Publish to VS Code Marketplace *** Blocked ***

**Goal:** Make the extension installable via VS Code extension panel.

**Blocked by:** T-004 (CHANGELOG.md), human providing `VSCE_PAT` secret

**What to do:**
1. Verify local install: `code --install-extension aahp-orchestrator-0.2.0.vsix`
2. Add marketplace publish step to release workflow (T-008)
3. Run `vsce publish` or publish via workflow

**Definition of done:**
- [ ] Extension visible on VS Code Marketplace
- [ ] CHANGELOG.md exists
- [ ] Version tag pushed

---

## Recently Completed

| Item | Resolution |
|------|-----------|
| T-002: Automated tests | 72 Vitest unit tests across 5 suites (aahp-reader, agent-spawner, session-monitor, statusbar, security) [2026-02-27] |
| T-001: CI pipeline | `.github/workflows/ci.yml` - compile + lint + test on push/PR [2026-02-27] |
| AAHP protocol structure | Created .ai/handoff/ with all 9 protocol files [2026-02-27] |

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
