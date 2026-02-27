# aahp-orchestrator: Next Actions for Incoming Agent

> Priority order. Work top-down.
> Each item must be self-contained - the agent must be able to start without asking questions.
> Blocked tasks go to the bottom.

---

## T-002: Add automated tests

**Goal:** Cover core logic (aahp-reader, context-injector, manifest parsing) with unit tests.

**Context:**
- VS Code extensions use `@vscode/test-electron` for integration tests
- Pure logic (file parsing, string manipulation) can be tested with plain Node/Vitest without VS Code
- Focus first on `src/aahp-reader.ts` - it reads and parses MANIFEST.json, STATUS.md, etc.
- Depends on T-001 (CI should run tests)

**What to do:**
1. Evaluate whether Vitest (no VS Code API mocking needed) or `@vscode/test-electron` is appropriate
2. Add test runner to `package.json` scripts: `"test": "vitest run"` or equivalent
3. Write tests for: MANIFEST.json parsing, `.aiignore` pattern matching, context string assembly
4. Update `STATUS.md` and `DASHBOARD.md` with test results

**Files:**
- `src/*.test.ts`: create test files alongside source
- `vitest.config.ts` or `jest.config.ts`: test runner config

**Definition of done:**
- [ ] At least 20 tests covering aahp-reader and context-injector
- [ ] All tests pass
- [ ] CI runs tests

---

## T-003: Publish to VS Code Marketplace *** Blocked ***

**Goal:** Make the extension installable via VS Code extension panel.

**Context:**
- Publisher ID: `homeofe` (configured in package.json)
- Requires `VSCE_PAT` (Personal Access Token) stored as GitHub Actions secret
- .vsix v0.2.0 already packaged - verify it installs correctly first
- Blocked until T-001 (CI) and T-002 (tests) are done

**What to do:**
1. Verify local install: `code --install-extension aahp-orchestrator-0.2.0.vsix`
2. Add marketplace publish workflow (separate from CI, triggered on `git tag v*`)
3. Add `CHANGELOG.md` with v0.1.0 and v0.2.0 entries (required by Marketplace)
4. Run `vsce publish` or publish via workflow

**Blocked by:** T-001, T-002, human providing `VSCE_PAT` secret

**Definition of done:**
- [ ] Extension visible on VS Code Marketplace
- [ ] CHANGELOG.md exists
- [ ] Version tag pushed

---

## Recently Completed

| Item | Resolution |
|------|-----------|
| T-001: CI pipeline | `.github/workflows/ci.yml` added - compile + lint on push/PR [2026-02-27] |
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
| Package config | `package.json` |
| Build config | `tsconfig.json` |
| Packaged .vsix | `aahp-orchestrator-0.2.0.vsix` |
| CI workflow | `.github/workflows/ci.yml` |
| ESLint config | `.eslintrc.json` |
